import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';
import { MetricsService } from '../metrics/metrics.service';

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const KEY_PREFIX = 'assets:allowed';

@Injectable()
export class AllowedAssetsCacheService {
  private readonly logger = new Logger(AllowedAssetsCacheService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.ttlSeconds = this.config.get<number>(
      'ALLOWED_ASSETS_CACHE_TTL_SECONDS',
      DEFAULT_TTL_SECONDS,
    );
  }

  private getCacheKey(): string {
    return `${KEY_PREFIX}:list`;
  }

  async getOrCompute<T>(compute: () => Promise<T[]>): Promise<T[]> {
    const key = this.getCacheKey();
    const cached = await this.redis.get<T[]>(key);
    if (cached) {
      this.metrics?.recordRedisCache('hit', 'allowed_assets');
      return cached;
    }

    this.metrics?.recordRedisCache('miss', 'allowed_assets');
    const result = await compute();
    await this.redis.set(key, result, this.ttlSeconds);
    return result;
  }

  async invalidateAll(): Promise<void> {
    await this.redis.del(this.getCacheKey());
    this.logger.debug('Allowed assets cache invalidated');
  }
}
