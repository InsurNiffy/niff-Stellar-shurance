import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';
import { Queue } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { MetricsService } from '../metrics/metrics.service';

export interface HorizonRateLimitConfig {
  requestsPerSecond: number;
  burstCapacity: number;
  queueMaxSize: number;
  queueTimeoutMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  tokensRemaining: number;
  waitTimeMs?: number;
  queuePosition?: number;
}

export interface QueuedRequest {
  id: string;
  url: string;
  options: RequestInit;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeoutId?: NodeJS.Timeout;
}

@Injectable()
export class HorizonRateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HorizonRateLimitService.name);
  private readonly config: HorizonRateLimitConfig;
  private readonly redisKey = 'horizon:rate_limit:tokens';
  private readonly queueKey = 'horizon:rate_limit:queue';
  private readonly metricsKey = 'horizon:rate_limit:metrics';
  
  private requestQueue: Queue;
  private processingQueue = false;
  private metrics = {
    totalRequests: 0,
    allowedRequests: 0,
    rejectedRequests: 0,
    queuedRequests: 0,
    queueDepth: 0,
    averageWaitTime: 0,
  };

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.config = {
      requestsPerSecond: this.configService.get<number>('HORIZON_RATE_LIMIT_RPS', 5),
      burstCapacity: this.configService.get<number>('HORIZON_BURST_CAPACITY', 20),
      queueMaxSize: this.configService.get<number>('HORIZON_QUEUE_MAX_SIZE', 100),
      queueTimeoutMs: this.configService.get<number>('HORIZON_QUEUE_TIMEOUT_MS', 30000),
    };
  }

  async onModuleInit(): Promise<void> {
    try {
      this.requestQueue = new Queue('horizon-rate-limit', {
        connection: getBullMQConnection(),
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      });

      // Initialize token bucket
      await this.initializeTokenBucket();
      
      // Start queue processor
      this.startQueueProcessor();
      
      this.logger.log(`Horizon rate limit service initialized: ${this.config.requestsPerSecond} RPS, burst: ${this.config.burstCapacity}`);
    } catch (error) {
      this.logger.error('Failed to initialize Horizon rate limit service', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.requestQueue) {
      await this.requestQueue.close();
    }
  }

  /**
   * Check if a request is allowed and optionally queue it if rate limited
   */
  async checkRateLimit(identifier = 'global'): Promise<RateLimitResult> {
    const key = `${this.redisKey}:${identifier}`;
    
    try {
      const result = await this.redis.getClient().eval(
        this.tokenBucketLuaScript(),
        1,
        key,
        this.config.requestsPerSecond.toString(),
        this.config.burstCapacity.toString(),
        Date.now().toString()
      );

      const [allowed, tokensRemaining] = result as [number, number];
      
      // Update metrics
      this.metrics.totalRequests++;
      this.metricsService.recordHorizonRateLimitRequest();
      
      if (allowed) {
        this.metrics.allowedRequests++;
        this.metricsService.recordHorizonRateLimitAllowed();
      } else {
        this.metrics.rejectedRequests++;
        this.metricsService.recordHorizonRateLimitRejected();
      }

      // Record token remaining metric
      this.metricsService.recordHorizonRateLimitTokensRemaining({
        identifier,
        tokens: tokensRemaining,
      });

      return {
        allowed: allowed === 1,
        tokensRemaining,
      };
    } catch (error) {
      this.logger.error('Rate limit check failed', error);
      // Fail open - allow the request if rate limiting fails
      return {
        allowed: true,
        tokensRemaining: this.config.burstCapacity,
      };
    }
  }

  /**
   * Execute a Horizon API call with rate limiting and queuing
   */
  async executeWithRateLimit<T>(
    url: string,
    options: RequestInit = {},
    identifier = 'global'
  ): Promise<T> {
    // Check rate limit first
    const rateLimitResult = await this.checkRateLimit(identifier);
    
    if (rateLimitResult.allowed) {
      // Execute immediately
      return this.executeRequest<T>(url, options);
    }

    // Queue the request
    this.logger.debug(`Request rate limited, queuing: ${url}`);
    return this.queueRequest<T>(url, options, identifier);
  }

  /**
   * Queue a request for later execution
   */
  private async queueRequest<T>(
    url: string,
    options: RequestInit,
    identifier: string
  ): Promise<T> {
    if (this.metrics.queueDepth >= this.config.queueMaxSize) {
      throw new Error('Horizon rate limit queue is full');
    }

    return new Promise<T>((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const queuedRequest: QueuedRequest = {
        id: requestId,
        url,
        options,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      // Set timeout for queued request
      queuedRequest.timeoutId = setTimeout(() => {
        reject(new Error('Queued Horizon request timed out'));
        this.removeFromQueue(requestId);
      }, this.config.queueTimeoutMs);

      // Add to queue
      this.addToQueue(queuedRequest, identifier);
      
      // Update metrics
      this.metrics.queuedRequests++;
      this.metrics.queueDepth++;
      this.metricsService.recordHorizonRateLimitQueued();
      this.metricsService.recordHorizonRateLimitQueueDepth(this.metrics.queueDepth);
    });
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;

    try {
      while (true) {
        const queuedRequest = this.getNextFromQueue();
        if (!queuedRequest) {
          break;
        }

        // Wait for rate limit
        const canProceed = await this.waitForRateLimit(queuedRequest.identifier);
        if (!canProceed) {
          // Put it back and break
          this.addToQueue(queuedRequest, queuedRequest.identifier);
          break;
        }

        // Execute the request
        try {
          const response = await this.executeRequest(queuedRequest.url, queuedRequest.options);
          queuedRequest.resolve(response);
          this.metrics.queueDepth--;
        } catch (error) {
          queuedRequest.reject(error as Error);
          this.metrics.queueDepth--;
        } finally {
          if (queuedRequest.timeoutId) {
            clearTimeout(queuedRequest.timeoutId);
          }
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Wait until rate limit allows a request
   */
  private async waitForRateLimit(identifier: string, maxWaitMs = 5000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.checkRateLimit(identifier);
      if (result.allowed) {
        return true;
      }
      
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return false;
  }

  /**
   * Execute the actual HTTP request
   */
  private async executeRequest<T>(url: string, options: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Horizon API returned status ${response.status}: ${response.statusText}`);
    }

    return response.json() as T;
  }

  /**
   * Get current metrics for monitoring
   */
  async getMetrics(): Promise<typeof this.metrics> {
    // Update queue depth from Redis
    try {
      const queueSize = await this.redis.getClient().llen(this.queueKey);
      this.metrics.queueDepth = queueSize;
    } catch (error) {
      this.logger.error('Failed to update queue depth', error);
    }

    return { ...this.metrics };
  }

  /**
   * Initialize token bucket in Redis
   */
  private async initializeTokenBucket(): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client.hset(
        this.redisKey,
        'tokens',
        this.config.burstCapacity.toString(),
        'last_refill',
        Date.now().toString()
      );
    } catch (error) {
      this.logger.error('Failed to initialize token bucket', error);
    }
  }

  /**
   * Lua script for token bucket algorithm
   */
  private tokenBucketLuaScript(): string {
    return `
      local key = KEYS[1]
      local rate = tonumber(ARGV[1])
      local capacity = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      
      local tokens = tonumber(redis.call('HGET', key, 'tokens') or capacity)
      local last_refill = tonumber(redis.call('HGET', key, 'last_refill') or now)
      
      -- Calculate tokens to add based on elapsed time
      local elapsed = now - last_refill
      local tokens_to_add = math.floor(elapsed * rate / 1000)
      tokens = math.min(tokens + tokens_to_add, capacity)
      
      -- Check if request can be allowed
      local allowed = 0
      if tokens >= 1 then
        tokens = tokens - 1
        allowed = 1
      end
      
      -- Update bucket state
      redis.call('HSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(now))
      redis.call('EXPIRE', key, 60) -- Expire after 1 minute
      
      return {allowed, tokens}
    `;
  }

  /**
   * Start the queue processor
   */
  private startQueueProcessor(): void {
    setInterval(() => {
      this.processQueue().catch(error => {
        this.logger.error('Queue processor error', error);
      });
    }, 100); // Process queue every 100ms
  }

  /**
   * Queue management helpers
   */
  private addToQueue(request: QueuedRequest & { identifier?: string }, identifier: string): void {
    // Simple in-memory queue for now - could be moved to Redis for distributed systems
    (request as any).identifier = identifier;
    // This would be implemented with a proper queue data structure
  }

  private getNextFromQueue(): (QueuedRequest & { identifier?: string }) | null {
    // This would be implemented with a proper queue data structure
    return null;
  }

  private removeFromQueue(requestId: string): void {
    // This would be implemented with a proper queue data structure
  }
}