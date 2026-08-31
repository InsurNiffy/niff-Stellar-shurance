import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

export interface AllowedAsset {
  code: string;
  issuer: string;
  enabled: boolean;
}

@Injectable()
export class AllowedAssetsCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AllowedAssetsCacheService.name);
  private refreshTimer?: NodeJS.Timeout;
  private readonly cacheKey = 'allowed:assets:v1';
  private readonly refreshIntervalMs: number;
  private readonly refreshJitterMs: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.refreshIntervalMs = this.config.get<number>(
      'ALLOWED_ASSETS_REFRESH_INTERVAL_MS',
      300000,
    );
    this.refreshJitterMs = this.config.get<number>(
      'ALLOWED_ASSETS_REFRESH_JITTER_MS',
      60000,
    );
  }

  onModuleInit(): void {
    this.scheduleRefresh();
  }

  onModuleDestroy(): void {
    this.stopRefresh();
  }

  private getRandomizedInterval(): number {
    const jitter = Math.random() * this.refreshJitterMs;
    return this.refreshIntervalMs + jitter;
  }

  private scheduleRefresh(): void {
    const interval = this.getRandomizedInterval();
    this.logger.debug(
      `Scheduling allowed assets refresh in ${interval.toFixed(0)}ms (base: ${this.refreshIntervalMs}ms, jitter: ${this.refreshJitterMs}ms)`,
    );

    this.refreshTimer = setTimeout(async () => {
      try {
        await this.refresh();
        this.scheduleRefresh();
      } catch (error) {
        this.logger.error(`Allowed assets refresh failed: ${error}`);
        this.scheduleRefresh();
      }
    }, interval);
  }

  private stopRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.logger.debug('Stopped allowed assets refresh');
    }
  }

  private async refresh(): Promise<void> {
    const assets = await this.fetchAssets();
    await this.redis.set(this.cacheKey, assets, this.getMaxStalenessBound());
    this.logger.log(`Refreshed allowed assets cache (${assets.length} assets)`);
  }

  private getMaxStalenessBound(): number {
    return Math.ceil((this.refreshIntervalMs + this.refreshJitterMs) / 1000);
  }

  private async fetchAssets(): Promise<AllowedAsset[]> {
    // TODO: Implement actual asset fetching from config or external source
    // For now, return a placeholder that can be overridden in tests
    return [];
  }

  async getAssets(): Promise<AllowedAsset[]> {
    const cached = await this.redis.get<AllowedAsset[]>(this.cacheKey);
    if (cached) {
      return cached;
    }
    return this.fetchAssets();
  }

  async invalidate(): Promise<void> {
    await this.redis.del(this.cacheKey);
    this.logger.debug('Invalidated allowed assets cache');
  }
}
