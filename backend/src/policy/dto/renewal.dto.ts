import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsPositive,
  IsOptional,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type { PolicyTypeEnum, RegionTierEnum } from '../../rpc/soroban.service';

export class BuildRenewalTransactionDto {
  @ApiProperty({ description: 'Stellar address of the policyholder', example: 'GABC...' })
  @IsString()
  @IsNotEmpty()
  holder!: string;

  @ApiProperty({ description: 'Per-holder monotonic policy ID (u32)', example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  policy_id!: number;

  /**
   * Age is required to deterministically recalculate the renewal premium using
   * the same on-chain formula as policy initiation. Must match the original
   * policy parameters to avoid premium manipulation.
   */
  @ApiProperty({ description: 'Policyholder age (must match original policy)', example: 35 })
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(120)
  age!: number;

  /**
   * Risk score [0–100] used in the premium formula. Must be provided by the
   * caller and validated against the original policy to prevent replay attacks
   * where a lower risk score is substituted to reduce the renewal premium.
   */
  @ApiProperty({ description: 'Risk score 0–100 (must match original policy)', example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  risk_score!: number;

  /**
   * Optional override for renewal duration in ledgers.
   * Defaults to POLICY_DURATION_LEDGERS (~1 year) if omitted.
   */
  @ApiPropertyOptional({ description: 'Renewal duration in ledgers (default: ~1 year)', example: 6307200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  duration_ledgers?: number;

  /**
   * SEP-41 asset contract ID for premium payment.
   * Must match the asset bound to the original policy (assetContractId).
   * Omit to use the policy's existing asset.
   */
  @ApiPropertyOptional({ description: 'SEP-41 asset contract ID (defaults to policy asset)' })
  @IsOptional()
  @IsString()
  asset?: string;
}

export class RenewalQuoteResponseDto {
  @ApiProperty({ description: 'Renewal premium in stroops (i128 as string)', example: '50000000' })
  premiumStroops!: string;

  @ApiProperty({ description: 'Renewal premium in XLM', example: '5.0000000' })
  premiumXlm!: string;

  @ApiProperty({ description: 'Previous policy expiry ledger', example: 1000000 })
  previousEndLedger!: number;

  @ApiProperty({ description: 'New policy expiry ledger after renewal', example: 7307200 })
  newEndLedger!: number;

  @ApiProperty({ description: 'Current ledger at time of quote', example: 950000 })
  currentLedger!: number;

  @ApiProperty({ description: 'Ledger at which the renewal window opened', example: 879040 })
  windowOpenLedger!: number;

  @ApiProperty({ description: 'Exclusive ledger at which the renewal window closes', example: 1017280 })
  windowCloseLedger!: number;

  @ApiProperty({ description: 'Whether the premium was computed on-chain or via local fallback' })
  premiumSource!: 'simulation' | 'local_fallback';
}

export class BuildRenewalTransactionResponseDto extends RenewalQuoteResponseDto {
  @ApiProperty({ description: 'Base64-encoded unsigned transaction XDR for wallet signing' })
  unsignedXdr!: string;

  @ApiProperty({ description: 'Minimum resource fee in stroops' })
  minResourceFee!: string;

  @ApiProperty({ description: 'Base fee in stroops' })
  baseFee!: string;

  @ApiProperty({ description: 'Total estimated fee in stroops' })
  totalEstimatedFee!: string;

  @ApiProperty({ description: 'Total estimated fee in XLM' })
  totalEstimatedFeeXlm!: string;

  @ApiProperty({ description: 'Addresses that must sign Soroban auth entries' })
  authRequirements!: Array<{ address: string; isContract: boolean }>;

  @ApiProperty({ description: 'Memo convention note' })
  memoConvention!: string;
}

/**
 * PolicyRenewed event payload — emitted exactly once per successful renewal.
 * Structured for off-chain indexing and timeline UIs.
 *
 * EVENT INTEGRITY:
 *   - Emitted only after the unsigned transaction is successfully assembled.
 *   - Contains previousEndLedger and newEndLedger for timeline reconstruction.
 *   - termVersion allows UIs to detect term changes between renewal cycles.
 *   - premiumPaidStroops enables cumulative premium tracking with checked arithmetic.
 */
export interface PolicyRenewedEvent {
  /** Composite policy key: holderAddress:policyId */
  policyCompositeId: string;
  holderAddress: string;
  policyId: number;
  /** Ledger at which the previous term expired (inclusive end of old term). */
  previousEndLedger: number;
  /** Ledger at which the new term expires (inclusive end of new term). */
  newEndLedger: number;
  /** Renewal premium in stroops (i128 as string) — use BigInt for arithmetic. */
  premiumPaidStroops: string;
  /** Term version hash or identifier, if the policy terms changed at renewal. */
  termVersion: string | null;
  /** Ledger at which the renewal was requested (for audit trail). */
  renewalRequestedAtLedger: number;
  /** ISO-8601 wall-clock timestamp of the renewal request (approximate). */
  renewalRequestedAt: string;
}
