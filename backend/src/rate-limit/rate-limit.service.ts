import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';
import {
  RATE_LIMIT_DEFAULTS,
  REDIS_KEYS,
  WALLET_RATE_LIMIT_DEFAULTS,
  GLOBAL_RATE_LIMIT_DEFAULTS,
} from './rate-limit.constants';

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  windowAnchor: number;
  windowResetLedger: number;
  overrideActive: boolean;
}

export interface CounterState {
  count: number;
  windowAnchor: number;
  limit: number;
  overrideActive: boolean;
}

@Injectable()
export class RateLimitService implements OnModuleInit {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeDefaults();
  }

  /**
   * Initialize Redis defaults on module startup
   */
  private async initializeDefaults(): Promise<void> {
    try {
      const client = this.redis.getClient();
      const exists = await client.exists(REDIS_KEYS.DEFAULTS);
      
      if (!exists) {
        await client.hset(
          REDIS_KEYS.DEFAULTS,
          'defaultLimit', RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT.toString(),
          'windowSize', RATE_LIMIT_DEFAULTS.WINDOW_SIZE_LEDGERS.toString(),
          'absoluteMax', RATE_LIMIT_DEFAULTS.ABSOLUTE_MAX_CAP.toString(),
        );
        this.logger.log('Rate limit defaults initialized in Redis');
      } else {
        this.logger.log('Rate limit defaults already exist in Redis');
      }
    } catch (error) {
      this.logger.warn(`Failed to initialize rate limit defaults: ${error}`);
    }
  }

  /**
   * Get window size from Redis defaults
   */
  private async getWindowSize(): Promise<number> {
    try {
      const client = this.redis.getClient();
      const windowSize = await client.hget(REDIS_KEYS.DEFAULTS, 'windowSize');
      return windowSize ? parseInt(windowSize, 10) : RATE_LIMIT_DEFAULTS.WINDOW_SIZE_LEDGERS;
    } catch (error) {
      this.logger.warn(`Failed to get window size: ${error}`);
      return RATE_LIMIT_DEFAULTS.WINDOW_SIZE_LEDGERS;
    }
  }

  /**
   * Get effective limit for a policy (custom or default)
   */
  async getEffectiveLimit(policyId: string): Promise<number> {
    try {
      const client = this.redis.getClient();
      const customLimit = await client.hget(REDIS_KEYS.CONFIG(policyId), 'limit');
      
      if (customLimit) {
        return parseInt(customLimit, 10);
      }

      const defaultLimit = await client.hget(REDIS_KEYS.DEFAULTS, 'defaultLimit');
      return defaultLimit ? parseInt(defaultLimit, 10) : RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT;
    } catch (error) {
      this.logger.warn(`Failed to get effective limit for ${policyId}: ${error}`);
      return RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT;
    }
  }

  /**
   * Check and reset window if expired
   */
  private async checkAndResetWindow(
    policyId: string,
    currentLedger: number,
  ): Promise<{ count: number; windowAnchor: number }> {
    try {
      const client = this.redis.getClient();
      const key = REDIS_KEYS.COUNTER(policyId);
      const data = await client.hgetall(key);

      if (!data.windowAnchor) {
        // First claim for this policy
        await client.hset(key, 'count', '0', 'windowAnchor', currentLedger.toString());
        return { count: 0, windowAnchor: currentLedger };
      }

      const windowAnchor = parseInt(data.windowAnchor, 10);
      const windowSize = await this.getWindowSize();

      if (currentLedger >= windowAnchor + windowSize) {
        // Window expired, reset counter
        await client.hset(key, 'count', '0', 'windowAnchor', currentLedger.toString());
        return { count: 0, windowAnchor: currentLedger };
      }

      // Window still active
      return { count: parseInt(data.count || '0', 10), windowAnchor };
    } catch (error) {
      this.logger.warn(`Failed to check/reset window for ${policyId}: ${error}`);
      // Fail open: return zero count to allow claim
      return { count: 0, windowAnchor: currentLedger };
    }
  }

  /**
   * Check if a claim can be filed and increment counter if allowed
   */
  async checkAndIncrement(policyId: string, currentLedger: number): Promise<RateLimitCheckResult> {
    try {
      const client = this.redis.getClient();
      
      // Check and reset window if needed
      const { count, windowAnchor } = await this.checkAndResetWindow(policyId, currentLedger);
      
      // Check if override is active
      const overrideActive = await client.hget(REDIS_KEYS.CONFIG(policyId), 'overrideActive');
      const isOverrideActive = overrideActive === 'true';
      
      // Get effective limit
      const limit = await this.getEffectiveLimit(policyId);
      const windowSize = await this.getWindowSize();
      const windowResetLedger = windowAnchor + windowSize;

      // If override is active, allow and increment
      if (isOverrideActive) {
        await client.hincrby(REDIS_KEYS.COUNTER(policyId), 'count', 1);
        return {
          allowed: true,
          currentCount: count + 1,
          limit,
          windowAnchor,
          windowResetLedger,
          overrideActive: true,
        };
      }

      // Check if limit exceeded
      if (count >= limit) {
        return {
          allowed: false,
          currentCount: count,
          limit,
          windowAnchor,
          windowResetLedger,
          overrideActive: false,
        };
      }

      // Increment counter
      await client.hincrby(REDIS_KEYS.COUNTER(policyId), 'count', 1);

      return {
        allowed: true,
        currentCount: count + 1,
        limit,
        windowAnchor,
        windowResetLedger,
        overrideActive: false,
      };
    } catch (error) {
      this.logger.error(`Rate limit check failed for ${policyId}: ${error}`);
      // Fail open: allow claim when Redis fails
      return {
        allowed: true,
        currentCount: 0,
        limit: RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT,
        windowAnchor: currentLedger,
        windowResetLedger: currentLedger + RATE_LIMIT_DEFAULTS.WINDOW_SIZE_LEDGERS,
        overrideActive: false,
      };
    }
  }

  /**
   * Get current counter state for a policy
   */
  async getCounterState(policyId: string): Promise<CounterState> {
    try {
      const client = this.redis.getClient();
      const counterData = await client.hgetall(REDIS_KEYS.COUNTER(policyId));
      const configData = await client.hgetall(REDIS_KEYS.CONFIG(policyId));
      
      const count = counterData.count ? parseInt(counterData.count, 10) : 0;
      const windowAnchor = counterData.windowAnchor ? parseInt(counterData.windowAnchor, 10) : 0;
      const limit = await this.getEffectiveLimit(policyId);
      const overrideActive = configData.overrideActive === 'true';

      return {
        count,
        windowAnchor,
        limit,
        overrideActive,
      };
    } catch (error) {
      this.logger.warn(`Failed to get counter state for ${policyId}: ${error}`);
      return {
        count: 0,
        windowAnchor: 0,
        limit: RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT,
        overrideActive: false,
      };
    }
  }

  /**
   * Set custom limit for a policy (admin only)
   */
  async setLimit(policyId: string, limit: number, actor: string): Promise<void> {
    if (limit < 1) {
      throw new BadRequestException('Limit must be at least 1');
    }

    if (limit > RATE_LIMIT_DEFAULTS.ABSOLUTE_MAX_CAP) {
      throw new BadRequestException(
        `Limit cannot exceed absolute maximum of ${RATE_LIMIT_DEFAULTS.ABSOLUTE_MAX_CAP}`,
      );
    }

    try {
      const client = this.redis.getClient();
      await client.hset(REDIS_KEYS.CONFIG(policyId), 'limit', limit.toString());
      this.logger.log(`Rate limit set for ${policyId}: ${limit} (by ${actor})`);
    } catch (error) {
      this.logger.error(`Failed to set rate limit for ${policyId}: ${error}`);
      throw new BadRequestException('Failed to set rate limit');
    }
  }

  /**
   * Enable manual override for a policy (admin only)
   */
  async enableOverride(policyId: string, actor: string, reason: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client.hset(REDIS_KEYS.CONFIG(policyId), 'overrideActive', 'true');
      this.logger.log(`Rate limit override enabled for ${policyId} by ${actor}: ${reason}`);
    } catch (error) {
      this.logger.error(`Failed to enable override for ${policyId}: ${error}`);
      throw new BadRequestException('Failed to enable override');
    }
  }

  /**
   * Disable manual override for a policy (admin only)
   */
  async disableOverride(policyId: string, actor: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client.hset(REDIS_KEYS.CONFIG(policyId), 'overrideActive', 'false');
      this.logger.log(`Rate limit override disabled for ${policyId} by ${actor}`);
    } catch (error) {
      this.logger.error(`Failed to disable override for ${policyId}: ${error}`);
      throw new BadRequestException('Failed to disable override');
    }
  }

  // ── Per-wallet sliding window rate limit ────────────────────────────────

  /**
   * Check if a wallet has exceeded its claim submission rate limit.
   * Uses a Redis sorted-set for a true sliding window.
   *
   * @returns { allowed, retryAfterSeconds }
   */
  async checkWalletLimit(walletAddress: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    try {
      const client = this.redis.getClient();
      const key = REDIS_KEYS.WALLET_WINDOW(walletAddress.toLowerCase());
      const nowMs = Date.now();
      const windowMs = this.config.get<number>('WALLET_RATE_LIMIT_WINDOW_SECONDS', WALLET_RATE_LIMIT_DEFAULTS.WINDOW_SECONDS) * 1000;
      const limit = this.config.get<number>('WALLET_RATE_LIMIT', WALLET_RATE_LIMIT_DEFAULTS.LIMIT);
      const windowStart = nowMs - windowMs;

      // Remove entries outside the sliding window
      await client.zremrangebyscore(key, 0, windowStart);

      // Count current entries in window
      const currentCount = await client.zcard(key);

      if (currentCount >= limit) {
        // Find the oldest entry in the window to calculate retry-after
        const oldest = await client.zrange(key, 0, 0, 'WITHSCORES');
        const oldestTimestamp = oldest.length > 1 ? parseInt(oldest[1], 10) : windowStart;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - nowMs) / 1000));
        this.logger.warn(`Wallet rate limit exceeded for ${walletAddress}: ${currentCount}/${limit}`);
        return { allowed: false, retryAfterSeconds };
      }

      // Add current request timestamp
      await client.zadd(key, nowMs, `${nowMs}-${Math.random().toString(36).slice(2)}`);
      await client.pexpire(key, windowMs * 2);

      return { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      this.logger.error(`Wallet rate limit check failed for ${walletAddress}: ${error}`);
      // Fail open
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  /**
   * Check per-wallet rate limit for evidence uploads with configurable parameters.
   * Uses a Redis sorted-set sliding window, keyed separately from claim submission.
   */
  async checkWalletEvidenceLimit(
    walletAddress: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    try {
      const client = this.redis.getClient();
      const key = `rate_limit:evidence:${walletAddress.toLowerCase()}`;
      const nowMs = Date.now();
      const windowMs = windowSeconds * 1000;
      const windowStart = nowMs - windowMs;

      await client.zremrangebyscore(key, 0, windowStart);
      const currentCount = await client.zcard(key);

      if (currentCount >= limit) {
        const oldest = await client.zrange(key, 0, 0, 'WITHSCORES');
        const oldestTimestamp = oldest.length > 1 ? parseInt(oldest[1], 10) : windowStart;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - nowMs) / 1000));
        return { allowed: false, retryAfterSeconds };
      }

      await client.zadd(key, nowMs, `${nowMs}-${Math.random().toString(36).slice(2)}`);
      await client.pexpire(key, windowMs * 2);

      return { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      this.logger.error(`Evidence rate limit check failed for ${walletAddress}: ${error}`);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  /**
   * Generic sliding-window rate limit check for an arbitrary key.
   * Used for one-off admin endpoints that don't warrant a dedicated method.
   */
  async checkLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    try {
      const client = this.redis.getClient();
      const nowMs = Date.now();
      const windowMs = windowSeconds * 1000;
      const windowStart = nowMs - windowMs;

      await client.zremrangebyscore(key, 0, windowStart);
      const currentCount = await client.zcard(key);

      if (currentCount >= limit) {
        return false;
      }

      await client.zadd(key, nowMs, `${nowMs}-${Math.random().toString(36).slice(2)}`);
      await client.pexpire(key, windowMs * 2);

      return true;
    } catch (error) {
      this.logger.error(`Rate limit check failed for ${key}: ${error}`);
      return true;
    }
  }

  // ── Global circuit breaker ──────────────────────────────────────────────

  /**
   * Check if the global claim submission rate limit (circuit breaker) is active.
   * Uses a Redis sorted-set for a true sliding window.
   *
   * @returns { allowed, retryAfterSeconds }
   */
  async checkGlobalLimit(): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    try {
      const client = this.redis.getClient();
      const key = REDIS_KEYS.GLOBAL_WINDOW;
      const nowMs = Date.now();
      const windowMs = this.config.get<number>('GLOBAL_RATE_LIMIT_WINDOW_SECONDS', GLOBAL_RATE_LIMIT_DEFAULTS.WINDOW_SECONDS) * 1000;
      const limit = this.config.get<number>('GLOBAL_RATE_LIMIT', GLOBAL_RATE_LIMIT_DEFAULTS.LIMIT);
      const windowStart = nowMs - windowMs;

      // Remove entries outside the sliding window
      await client.zremrangebyscore(key, 0, windowStart);

      // Count current entries in window
      const currentCount = await client.zcard(key);

      if (currentCount >= limit) {
        const oldest = await client.zrange(key, 0, 0, 'WITHSCORES');
        const oldestTimestamp = oldest.length > 1 ? parseInt(oldest[1], 10) : windowStart;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - nowMs) / 1000));
        this.logger.warn(`Global rate limit (circuit breaker) triggered: ${currentCount}/${limit}`);
        return { allowed: false, retryAfterSeconds };
      }

      // Add current request timestamp
      await client.zadd(key, nowMs, `${nowMs}-${Math.random().toString(36).slice(2)}`);
      await client.pexpire(key, windowMs * 2);

      return { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      this.logger.error(`Global rate limit check failed: ${error}`);
      // Fail open
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}
