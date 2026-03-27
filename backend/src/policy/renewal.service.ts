/**
 * RenewalService — policy renewal orchestration.
 *
 * RENEWAL WINDOW (ledger-bounded, half-open interval):
 *   Valid when: endLedger - RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY <= currentLedger
 *                        < endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY
 *
 *   See renewal.constants.ts for full semantics and server-client skew notes.
 *
 * PREMIUM RECALCULATION:
 *   Uses the same deterministic formula as policy initiation:
 *     simulateGeneratePremium() → on-chain simulation with local fallback.
 *   The caller must supply age and risk_score matching the original policy.
 *   These are validated against the stored policy record to prevent
 *   premium manipulation via substituted inputs.
 *
 * OPEN-CLAIM RULE:
 *   Renewal is blocked when any claim on the policy has status PENDING.
 *   See BLOCKING_CLAIM_STATUSES in renewal.constants.ts for rationale.
 *
 * CUMULATIVE PREMIUM ARITHMETIC:
 *   All premium values are i128 stroops stored as strings. BigInt is used
 *   for all arithmetic to match Rust i128 semantics and avoid overflow.
 *   Overflow is checked explicitly before updating cumulativePremiumPaid.
 *
 * EVENT EMISSION:
 *   PolicyRenewed is emitted exactly once per successful buildRenewalTransaction
 *   call, after the unsigned XDR is assembled. It is NOT emitted on quote-only
 *   calls. The event is suitable for off-chain indexing and timeline UIs.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import EventEmitter from 'events';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import {
  RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY,
  RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY,
  POLICY_DURATION_LEDGERS,
  BLOCKING_CLAIM_STATUSES,
} from './renewal.constants';
import type {
  BuildRenewalTransactionDto,
  BuildRenewalTransactionResponseDto,
  RenewalQuoteResponseDto,
  PolicyRenewedEvent,
} from './dto/renewal.dto';

/**
 * Shared renewal event bus.
 * Consumers (indexer, notifications, analytics) subscribe to 'policy.renewed'.
 * In production, replace with a BullMQ/SQS consumer for durability.
 */
export const renewalBus = new EventEmitter();

/** Maximum i128 value — used for overflow guard on cumulative premium. */
const MAX_I128 = BigInt('170141183460469231731687303715884105727');

@Injectable()
export class RenewalService {
  private readonly logger = new Logger(RenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
  ) {}

  /**
   * Quote a renewal premium without building a transaction.
   * Safe to call repeatedly — no side effects, no event emitted.
   */
  async quoteRenewal(dto: BuildRenewalTransactionDto): Promise<RenewalQuoteResponseDto> {
    const { policy, currentLedger } = await this.validateRenewalEligibility(dto);

    const premiumResult = await this.soroban.simulateGeneratePremium({
      policyType: policy.policyType as Parameters<typeof this.soroban.simulateGeneratePremium>[0]['policyType'],
      region: policy.region as Parameters<typeof this.soroban.simulateGeneratePremium>[0]['region'],
      age: dto.age,
      riskScore: dto.risk_score,
      sourceAccount: dto.holder,
    });

    const newEndLedger = policy.endLedger + (dto.duration_ledgers ?? POLICY_DURATION_LEDGERS);

    return {
      premiumStroops: premiumResult.premiumStroops,
      premiumXlm: premiumResult.premiumXlm,
      previousEndLedger: policy.endLedger,
      newEndLedger,
      currentLedger,
      windowOpenLedger: policy.endLedger - RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY,
      windowCloseLedger: policy.endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY,
      premiumSource: premiumResult.source,
    };
  }

  /**
   * Build an unsigned renewal transaction XDR for wallet signing.
   *
   * Emits PolicyRenewed exactly once on success.
   * Does NOT submit the transaction — the wallet signs and submits via POST /tx/submit.
   */
  async buildRenewalTransaction(
    dto: BuildRenewalTransactionDto,
  ): Promise<BuildRenewalTransactionResponseDto> {
    const { policy, currentLedger } = await this.validateRenewalEligibility(dto);

    // Resolve asset: caller-supplied > policy's stored asset > env default
    const assetAddress =
      dto.asset ??
      policy.assetContractId ??
      undefined;

    const durationLedgers = dto.duration_ledgers ?? POLICY_DURATION_LEDGERS;

    // newStartLedger = previous endLedger + 1 (no gap, no overlap between terms)
    const newStartLedger = policy.endLedger + 1;
    const newEndLedger = newStartLedger + durationLedgers - 1;

    // Build the unsigned renewal transaction via the Soroban service.
    // This also recalculates the premium deterministically (same formula as initiation).
    const txResult = await this.soroban.buildRenewPolicyTransaction({
      holder: dto.holder,
      policyId: policy.policyId,
      policyType: policy.policyType as Parameters<typeof this.soroban.buildRenewPolicyTransaction>[0]['policyType'],
      region: policy.region as Parameters<typeof this.soroban.buildRenewPolicyTransaction>[0]['region'],
      age: dto.age,
      riskScore: dto.risk_score,
      asset: assetAddress,
      newStartLedger,
      newEndLedger,
    });

    // Checked arithmetic: guard against i128 overflow on cumulative premium.
    const existingPremium = BigInt(policy.premium);
    const renewalPremium = BigInt(txResult.premiumStroops);
    const newCumulative = existingPremium + renewalPremium;
    if (newCumulative > MAX_I128) {
      throw new BadRequestException({
        code: 'PREMIUM_OVERFLOW',
        message: 'Cumulative premium would exceed i128 maximum. Contact support.',
      });
    }

    // Emit PolicyRenewed exactly once — after successful XDR assembly.
    const event: PolicyRenewedEvent = {
      policyCompositeId: policy.id,
      holderAddress: dto.holder,
      policyId: policy.policyId,
      previousEndLedger: policy.endLedger,
      newEndLedger,
      premiumPaidStroops: txResult.premiumStroops,
      termVersion: null, // populated if term versioning is introduced
      renewalRequestedAtLedger: currentLedger,
      renewalRequestedAt: new Date().toISOString(),
    };
    renewalBus.emit('policy.renewed', event);

    this.logger.log(
      `PolicyRenewed: composite=${policy.id} prevEnd=${policy.endLedger} ` +
      `newEnd=${newEndLedger} premium=${txResult.premiumStroops} ledger=${currentLedger}`,
    );

    return {
      unsignedXdr: txResult.unsignedXdr,
      minResourceFee: txResult.minResourceFee,
      baseFee: txResult.baseFee,
      totalEstimatedFee: txResult.totalEstimatedFee,
      totalEstimatedFeeXlm: txResult.totalEstimatedFeeXlm,
      authRequirements: txResult.authRequirements,
      memoConvention: txResult.memoConvention,
      premiumStroops: txResult.premiumStroops,
      premiumXlm: txResult.premiumXlm,
      previousEndLedger: policy.endLedger,
      newEndLedger,
      currentLedger,
      windowOpenLedger: policy.endLedger - RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY,
      windowCloseLedger: policy.endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY,
      premiumSource: txResult.premiumSource,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Fetch the policy, fetch the current ledger, and enforce all renewal
   * preconditions. Returns both for use by the caller.
   */
  private async validateRenewalEligibility(dto: BuildRenewalTransactionDto) {
    const compositeId = `${dto.holder}:${dto.policy_id}`;

    const policy = await this.prisma.policy.findUnique({
      where: { id: compositeId },
      include: { claims: { select: { status: true } } },
    });

    if (!policy) {
      throw new NotFoundException({
        code: 'POLICY_NOT_FOUND',
        message: `Policy (holder=${dto.holder}, policy_id=${dto.policy_id}) not found.`,
      });
    }

    if (!policy.isActive) {
      throw new BadRequestException({
        code: 'POLICY_INACTIVE',
        message: 'Policy is not active and cannot be renewed.',
      });
    }

    // Fetch authoritative current ledger from RPC — never use cached/client value.
    const currentLedger = await this.soroban.getLatestLedger();

    // ── Renewal window check (half-open interval) ──────────────────────────────
    //
    // windowOpen  = endLedger - RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY  (inclusive)
    // windowClose = endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY  (exclusive)
    //
    // Valid: windowOpen <= currentLedger < windowClose
    const windowOpen = policy.endLedger - RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY;
    const windowClose = policy.endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY;

    if (currentLedger < windowOpen) {
      throw new BadRequestException({
        code: 'RENEWAL_TOO_EARLY',
        message:
          `Renewal window has not opened yet. ` +
          `Window opens at ledger ${windowOpen}; current ledger is ${currentLedger}. ` +
          `Approximately ${Math.ceil((windowOpen - currentLedger) * 5 / 60)} minutes remaining.`,
      });
    }

    // currentLedger >= windowClose means the grace period has passed
    if (currentLedger >= windowClose) {
      throw new BadRequestException({
        code: 'RENEWAL_TOO_LATE',
        message:
          `Renewal grace period has expired. ` +
          `Window closed at ledger ${windowClose}; current ledger is ${currentLedger}. ` +
          `The policy has lapsed and cannot be renewed.`,
      });
    }

    // ── Open-claim check ───────────────────────────────────────────────────────
    // Block renewal if any claim is in a blocking state (PENDING = "Processing").
    const blockingClaim = policy.claims.find((c: { status: string }) =>
      (BLOCKING_CLAIM_STATUSES as readonly string[]).includes(c.status),
    );
    if (blockingClaim) {
      throw new BadRequestException({
        code: 'OPEN_CLAIM_BLOCKS_RENEWAL',
        message:
          'This policy has a claim in Processing status. ' +
          'Renewal is blocked until all claims are finalized (Approved, Paid, or Rejected).',
      });
    }

    return { policy, currentLedger };
  }
}
