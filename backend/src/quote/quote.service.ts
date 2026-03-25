/**
 * QuoteService — computes insurance premiums via Soroban simulation or local fallback.
 *
 * Staleness note: local_fallback matches the contract at compile time. A contract
 * upgrade changes on-chain multipliers; redeploy this service to stay in sync.
 * Precision: premiumStroops is a string — never parse to JS number before display.
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { SorobanService } from '../rpc/soroban.service';
import type { GeneratePremiumDto } from './dto/generate-premium.dto';

@Injectable()
export class QuoteService {
  constructor(private readonly soroban: SorobanService) {}

  async getQuote(dto: GeneratePremiumDto) {
    const inputs = {
      policy_type: dto.policy_type,
      region: dto.region,
      age: dto.age,
      risk_score: dto.risk_score,
    };

    if (dto.source_account) {
      try {
        const sim = await this.soroban.simulateGeneratePremium({
          policyType: dto.policy_type,
          region: dto.region,
          age: dto.age,
          riskScore: dto.risk_score,
          sourceAccount: dto.source_account,
        });
        return { ...sim, inputs };
      } catch (err) {
        // Surface errors that the client must act on
        if (err instanceof BadRequestException) {
          const body = err.getResponse() as { code?: string };
          if (
            body?.code === 'ACCOUNT_NOT_FOUND' ||
            body?.code === 'WRONG_NETWORK'
          ) {
            throw err;
          }
        }
        // CONTRACT_NOT_DEPLOYED or RPC errors → fall through to local
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
