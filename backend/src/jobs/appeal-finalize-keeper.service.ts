import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { ConfigService } from '@nestjs/config';

/**
 * AppealFinalizeKeeperService — Scheduled job that scans for UNDER_APPEAL claims
 * past their deadline and calls finalize_appeal automatically.
 *
 * The contract's finalize_appeal function is permissionless but needs to be called
 * once a claim's appeal deadline passes. This keeper ensures the call is made
 * reliably, with automatic retry on transient failures and alerting on persistent ones.
 *
 * Idempotent: safely handles claims already finalized (e.g., by manual calls).
 *
 * Retry strategy: Exponential backoff (base 2, max 3 retries) for transient failures.
 * Persistent failure threshold: 3 consecutive failures per claim per cycle triggers alert.
 */
@Injectable()
export class AppealFinalizeKeeperService {
  private readonly logger = new Logger(AppealFinalizeKeeperService.name);
  private readonly maxRetries = 3;
  private readonly retryBaseDelayMs = 1000; // 1 second
  private readonly persistentFailureThreshold = 3;

  // Track consecutive failures per claim (claimId -> count)
  private failureTracker: Map<number, number> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Runs every 15 minutes (configurable). Scans for UNDER_APPEAL claims whose
   * deadline has passed and calls finalize_appeal with retry on transient failures.
   */
  @Cron('0 */15 * * * *')
  async runFinalizationCycle(): Promise<void> {
    this.logger.log('Starting appeal finalization cycle...');

    try {
      const keeperSourceAccount = this.config.get<string>(
        'CLAIM_KEEPER_SOURCE_ACCOUNT',
      );
      if (!keeperSourceAccount) {
        this.logger.warn(
          'CLAIM_KEEPER_SOURCE_ACCOUNT not configured — skipping finalization cycle',
        );
        return;
      }

      // Get current ledger from on-chain
      const currentLedger = await this.soroban.getLatestLedger();
      this.logger.log(`Current ledger: ${currentLedger}`);

      // Fetch all UNDER_APPEAL claims from the database
      const underAppealClaims = await this.prisma.claim.findMany({
        where: { status: 'UNDER_APPEAL', deletedAt: null },
        select: { id: true },
      });

      if (underAppealClaims.length === 0) {
        this.logger.log('No UNDER_APPEAL claims found — nothing to finalize');
        return;
      }

      this.logger.log(
        `Found ${underAppealClaims.length} UNDER_APPEAL claims; querying on-chain deadline data...`,
      );

      // Query on-chain claim data (includes appeal_open_deadline_ledger)
      const claimIds = underAppealClaims.map((c) => c.id);
      const onChainClaims = await this.soroban.simulateGetClaimsBatch({
        ids: claimIds,
        sourceAccount: keeperSourceAccount,
      });

      // Identify expired claims (deadline <= current ledger)
      const expiredClaims: number[] = [];
      for (let i = 0; i < claimIds.length; i++) {
        const onChainClaim = onChainClaims[i];
        if (!onChainClaim) {
          this.logger.debug(`Claim ${claimIds[i]} not found on-chain — skipping`);
          continue;
        }

        const deadlineLedger =
          (onChainClaim.appeal_open_deadline_ledger as number) || 0;
        if (deadlineLedger <= currentLedger) {
          expiredClaims.push(claimIds[i]);
          this.logger.debug(
            `Claim ${claimIds[i]} expired: deadline ${deadlineLedger} <= current ${currentLedger}`,
          );
        } else {
          this.logger.debug(
            `Claim ${claimIds[i]} not expired: deadline ${deadlineLedger} > current ${currentLedger}`,
          );
        }
      }

      if (expiredClaims.length === 0) {
        this.logger.log('No expired appeals found — finalization not needed');
        return;
      }

      this.logger.log(
        `Found ${expiredClaims.length} expired appeal(s); calling finalize_appeal...`,
      );

      // Finalize each expired claim with retry on transient failures
      for (const claimId of expiredClaims) {
        await this.finalizeClaimWithRetry(claimId);
      }

      this.logger.log('Appeal finalization cycle complete.');
    } catch (err) {
      this.logger.error(`Appeal finalization cycle failed: ${err}`);
    }
  }

  /**
   * Call finalize_appeal with exponential backoff retry on transient failures.
   * Gracefully handles contract-level errors (e.g., already finalized).
   */
  private async finalizeClaimWithRetry(claimId: number): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.log(`Finalizing claim ${claimId} (attempt ${attempt + 1})...`);
        const result = await this.soroban.finalizeAppeal(claimId);
        this.logger.log(
          `Successfully finalized claim ${claimId}: txHash=${result.txHash}, ledger=${result.ledger}`,
        );
        // Reset failure counter on success
        this.failureTracker.delete(claimId);
        return;
      } catch (err) {
        lastError = err as Error;
        const errorMsg = lastError.message || String(lastError);

        // Check if this is an already-finalized error (idempotency: treat as success)
        if (
          errorMsg.toLowerCase().includes('not in under_appeal') ||
          errorMsg.toLowerCase().includes('already finalized') ||
          errorMsg.toLowerCase().includes('invalid state')
        ) {
          this.logger.debug(
            `Claim ${claimId} is already finalized or not in UNDER_APPEAL state — skipping`,
          );
          this.failureTracker.delete(claimId);
          return;
        }

        // Transient error (network, RPC timeout, etc.)
        if (attempt < this.maxRetries) {
          const delayMs = this.retryBaseDelayMs * Math.pow(2, attempt);
          this.logger.warn(
            `Claim ${claimId} finalization attempt ${attempt + 1} failed: ${errorMsg}. ` +
              `Retrying after ${delayMs}ms...`,
          );
          await this.sleep(delayMs);
        } else {
          this.logger.error(
            `Claim ${claimId} finalization failed after ${this.maxRetries + 1} attempts: ${errorMsg}`,
          );
        }
      }
    }

    // Persistent failure: track and alert if threshold exceeded
    const failureCount = (this.failureTracker.get(claimId) || 0) + 1;
    this.failureTracker.set(claimId, failureCount);

    if (failureCount >= this.persistentFailureThreshold) {
      this.logger.warn(
        `ALERT: Claim ${claimId} has persistent failure (${failureCount} cycles). ` +
          `Last error: ${lastError?.message || 'unknown'}. Manual intervention may be required.`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
