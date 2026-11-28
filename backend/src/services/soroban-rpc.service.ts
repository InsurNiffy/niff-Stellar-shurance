import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SorobanRpc } from '@stellar/stellar-sdk';
import CircuitBreaker from 'opossum';
import { withSorobanSpan } from './soroban-span';

export interface SorobanRpcConfig {
  rpcUrl: string;
  networkPassphrase: string;
  maxRetries?: number;
  baseDelayMs?: number;
  breakerTimeoutMs?: number;
  breakerErrorThreshold?: number;
  breakerResetTimeoutMs?: number;
}

export interface BreakerState {
  state: 'closed' | 'open' | 'halfOpen';
  failures: number;
  successes: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_BREAKER_TIMEOUT_MS = 10_000;
const DEFAULT_BREAKER_ERROR_THRESHOLD = 3;
const DEFAULT_BREAKER_RESET_TIMEOUT_MS = 30_000;

@Injectable()
export class SorobanRpcService implements OnModuleDestroy {
  private readonly logger = new Logger(SorobanRpcService.name);
  private readonly server: SorobanRpc.Server;
  private readonly breaker: CircuitBreaker;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(private readonly config: SorobanRpcConfig) {
    this.server = new SorobanRpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith('http://'),
    });
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

    this.breaker = new CircuitBreaker(
      (method: string, args: unknown[]) => this.invoke(method, args),
      {
        timeout: config.breakerTimeoutMs ?? DEFAULT_BREAKER_TIMEOUT_MS,
        errorThresholdPercentage: 100,
        volumeThreshold: config.breakerErrorThreshold ?? DEFAULT_BREAKER_ERROR_THRESHOLD,
        resetTimeout: config.breakerResetTimeoutMs ?? DEFAULT_BREAKER_RESET_TIMEOUT_MS,
        rollingCountTimeout: 60_000,
      },
    );

    this.breaker.on('open', () => this.logger.warn('Soroban RPC circuit breaker opened'));
    this.breaker.on('halfOpen', () => this.logger.log('Soroban RPC circuit breaker half-open (probe)'));
    this.breaker.on('close', () => this.logger.log('Soroban RPC circuit breaker closed'));
  }

  /**
   * Execute a Soroban RPC call through the circuit breaker with retry and tracing.
   * Rate-limit headers (X-RateLimit-Limit / X-RateLimit-Remaining / Retry-After)
   * are respected by the underlying SDK; retries use exponential backoff.
   */
  async call<T>(method: string, args: unknown[] = [], contractId?: string): Promise<T> {
    return withSorobanSpan({ contractId, method }, () =>
      this.breaker.fire(method, args) as Promise<T>,
    );
  }

  getServer(): SorobanRpc.Server {
    return this.server;
  }

  getBreakerState(): BreakerState {
    const stats = this.breaker.stats;
    return {
      state: this.breaker.opened ? 'open' : this.breaker.halfOpen ? 'halfOpen' : 'closed',
      failures: stats.failures,
      successes: stats.successes,
    };
  }

  private async invoke(method: string, args: unknown[]): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const fn = (this.server as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
        if (typeof fn !== 'function') {
          throw new Error(`Unknown Soroban RPC method: ${method}`);
        }
        return await fn.apply(this.server, args);
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries - 1) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          this.logger.warn(
            `Soroban RPC ${method} failed (attempt ${attempt + 1}/${this.maxRetries}); retrying in ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  onModuleDestroy(): void {
    this.breaker.shutdown();
  }
}
