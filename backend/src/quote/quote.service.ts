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
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { SorobanService } from '../rpc/soroban.service';
import { MetricsService } from '../metrics/metrics.service';
import { QuoteSimulationCacheService } from './quote-simulation-cache.service';
import type { GeneratePremiumDto } from './dto/generate-premium.dto';

export interface GetQuoteOptions {
  /** When true, skip Redis read/write (e.g. Cache-Control: no-cache). */
  bypassCache?: boolean;
  /** Correlation id propagated as a span attribute (x-request-id). */
  requestId?: string;
}

const tracer = trace.getTracer('quote-service');

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
        const cached = await this.withSpan(
          'quote.cache.check',
          options?.requestId,
          async (span) => {
            const result = await this.quoteSimulationCache.get(dto);
            span.setAttribute('cache.hit', result != null);
            return result;
          },
        );
        if (cached) {
          this.metrics?.recordQuoteSimulationCache('hit');
          return { ...cached, inputs };
        }
        this.metrics?.recordQuoteSimulationCache('miss');
      }

      try {
        const sim = await this.withSpan(
          'soroban.rpc.simulate_generate_premium',
          options?.requestId,
          async (span) => {
            span.setAttribute('rpc.method', 'simulateTransaction');
            span.setAttribute('rpc.system', 'soroban');
            const result = await this.soroban.simulateGeneratePremium({
              policyType: dto.policy_type,
              region: dto.region,
              age: dto.age,
              riskScore: dto.risk_score,
              sourceAccount: dto.source_account,
            });
            span.setAttribute('rpc.source', result.source);
            return result;
          },
        );

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

  /**
   * Runs `fn` inside a named span, tagging it with the request id so trace IDs
   * correlate with structured log `requestId` fields. No-op when tracing is
   * disabled (the OTel API returns a non-recording span).
   */
  private async withSpan<T>(
    name: string,
    requestId: string | undefined,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return tracer.startActiveSpan(name, async (span) => {
      if (requestId) {
        span.setAttribute('x-request-id', requestId);
      }
      try {
        return await fn(span);
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}
