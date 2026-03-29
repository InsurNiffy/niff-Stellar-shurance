/**
 * QuoteService — computes insurance premiums via Soroban simulation or local fallback.
 *
 * Staleness note: local_fallback matches the contract at compile time. A contract
 * upgrade changes on-chain multipliers; redeploy this service to stay in sync.
 * Successful on-chain simulations may be cached in Redis (short TTL); multiplier
 * table updates invalidate the cache via the indexer (`niffyins:tbl_upd`).
 * Precision: premiumStroops is a string — never parse to JS number before display.
 */
import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { SorobanService } from '../rpc/soroban.service';
import { MetricsService } from '../metrics/metrics.service';
import { QuoteSimulationCacheService } from './quote-simulation-cache.service';
import type { GeneratePremiumDto } from './dto/generate-premium.dto';

export interface GetQuoteOptions {
  /** When true, skip Redis read/write (e.g. Cache-Control: no-cache). */
  bypassCache?: boolean;
}

@Injectable()
export class QuoteService {
  constructor(
    private readonly soroban: SorobanService,
    private readonly quoteSimulationCache: QuoteSimulationCacheService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async getQuote(dto: GeneratePremiumDto, options?: GetQuoteOptions) {
    const inputs = {
      policy_type: dto.policy_type,
      region: dto.region,
      age: dto.age,
      risk_score: dto.risk_score,
    };

    if (dto.source_account) {
      const bypass = options?.bypassCache === true;

      if (bypass) {
        this.metrics?.recordQuoteSimulationCache('bypass');
      } else {
        const cached = await this.quoteSimulationCache.get(dto);
        if (cached) {
          this.metrics?.recordQuoteSimulationCache('hit');
          return { ...cached, inputs };
        }
        this.metrics?.recordQuoteSimulationCache('miss');
      }

      try {
        const sim = await this.soroban.simulateGeneratePremium({
          policyType: dto.policy_type,
          region: dto.region,
          age: dto.age,
          riskScore: dto.risk_score,
          sourceAccount: dto.source_account,
        });

        if (sim.source === 'simulation' && !bypass) {
          await this.quoteSimulationCache.set(dto, {
            premiumStroops: sim.premiumStroops,
            premiumXlm: sim.premiumXlm,
            minResourceFee: sim.minResourceFee,
            source: 'simulation',
            inputs,
          });
        }

        return { ...sim, inputs };
      } catch (err) {
        if (err instanceof BadRequestException) {
          const body = err.getResponse() as { code?: string };
          if (
            body?.code === 'ACCOUNT_NOT_FOUND' ||
            body?.code === 'WRONG_NETWORK'
          ) {
            throw err;
          }
        }
      }
    }

    const premiumStroops = SorobanService.computePremiumLocal({
      policyType: dto.policy_type,
      region: dto.region,
      age: dto.age,
      riskScore: dto.risk_score,
    });

    return {
      premiumStroops: premiumStroops.toString(),
      premiumXlm: SorobanService.stroopsToXlm(premiumStroops),
      minResourceFee: '0',
      source: 'local_fallback',
      inputs,
    };
  }
}
