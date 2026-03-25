import { Injectable } from '@nestjs/common';
import { SorobanService } from '../rpc/soroban.service';
import type { BuildTransactionDto } from './dto/build-transaction.dto';

@Injectable()
export class PolicyService {
  constructor(private readonly soroban: SorobanService) {}

  async buildTransaction(dto: BuildTransactionDto) {
    return this.soroban.buildInitiatePolicyTransaction({
      holder: dto.holder,
      policyType: dto.policy_type,
      region: dto.region,
      coverage: BigInt(dto.coverage),
      age: dto.age,
      riskScore: dto.risk_score,
      asset: dto.asset,
      startLedger: dto.start_ledger,
      durationLedgers: dto.duration_ledgers,
    });
  }
}
