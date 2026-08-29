import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';

/**
 * Successful appeal simulation payload cached for the /simulate path only.
 * Never includes unsignedXdr — that must always come from a fresh /build-transaction (#1327).
 */
export interface CachedAppealSimulationPayload {
  ok: true;
  claimId: number;
  walletAddress: string;
  minResourceFee: string;
  baseFee: string;
  totalEstimatedFee: string;
  totalEstimatedFeeXlm: string;
  currentLedger: number;
}

const KEY_PREFIX = 'appeal:sim:v1:';

@Injectable()
export class AppealSimulationCacheService {
  private readonly logger = new Logger(AppealSimulationCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    const v = this.config.get<string>('APPEAL_SIMULATION_CACHE_ENABLED', 'true');
    return v !== 'false' && v !== '0';
  }

  private get ttlSeconds(): number {
    return Number(this.config.get<number>('APPEAL_SIMULATION_CACHE_TTL_SECONDS', 30));
  }

  buildRedisKey(claimId: number, walletAddress: string): string {
    return `${KEY_PREFIX}${claimId}:${walletAddress}`;
  }

  async get(
    claimId: number,
    walletAddress: string,
  ): Promise<CachedAppealSimulationPayload | null> {
    if (!this.enabled) return null;
    return this.redis.get<CachedAppealSimulationPayload>(
      this.buildRedisKey(claimId, walletAddress),
    );
  }

  async set(
    claimId: number,
    walletAddress: string,
    value: CachedAppealSimulationPayload,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.redis.set(this.buildRedisKey(claimId, walletAddress), value, this.ttlSeconds);
    this.logger.debug(
      `Cached appeal simulation claim=${claimId} wallet=${walletAddress} ttl=${this.ttlSeconds}s`,
    );
  }
}
