import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';
import type { GeneratePremiumDto } from './dto/generate-premium.dto';
import { buildQuoteSimulationCacheKeyHash } from './quote-simulation-cache-key.util';

/** Successful on-chain simulation payload only (never errors or local_fallback). */
export interface CachedQuoteSimulationPayload {
  premiumStroops: string;
  premiumXlm: string;
  minResourceFee: string;
  source: 'simulation';
  inputs: {
    policy_type: string;
    region: string;
    age: number;
    risk_score: number;
  };
}

const KEY_PREFIX = 'quote:sim:v1:';

@Injectable()
export class QuoteSimulationCacheService {
  private readonly logger = new Logger(QuoteSimulationCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    const v = this.config.get<string>('QUOTE_SIMULATION_CACHE_ENABLED', 'true');
    return v !== 'false' && v !== '0';
  }

  private get ttlSeconds(): number {
    return Number(this.config.get<number>('QUOTE_SIMULATION_CACHE_TTL_SECONDS', 30));
  }

  private get contractId(): string {
    return this.config.get<string>('CONTRACT_ID', '');
  }

  private get networkPassphrase(): string {
    return this.config.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      'Test SDF Network ; September 2015',
    );
  }

  buildRedisKey(dto: GeneratePremiumDto): string {
    const hash = buildQuoteSimulationCacheKeyHash(
      dto,
      this.contractId,
      this.networkPassphrase,
    );
    return `${KEY_PREFIX}${hash}`;
  }

  async get(dto: GeneratePremiumDto): Promise<CachedQuoteSimulationPayload | null> {
    if (!this.enabled) return null;
    return this.redis.get<CachedQuoteSimulationPayload>(this.buildRedisKey(dto));
  }

  async set(dto: GeneratePremiumDto, value: CachedQuoteSimulationPayload): Promise<void> {
    if (!this.enabled) return;
    await this.redis.set(this.buildRedisKey(dto), value, this.ttlSeconds);
  }

  /**
   * Drop all quote simulation entries (e.g. after on-chain multiplier table update).
   */
  async invalidateAll(): Promise<void> {
    const pattern = `${KEY_PREFIX}*`;
    try {
      await this.redis.delPattern(pattern);
      this.logger.log(`Invalidated quote simulation cache (${pattern})`);
    } catch (e) {
      this.logger.warn(`Quote cache invalidation failed: ${e}`);
    }
  }
}
