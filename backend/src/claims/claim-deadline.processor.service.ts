/**
 * Scans for on-chain Processing claims past voting deadline and invokes finalize_claim.
 *
 * PENDING in Postgres corresponds to on-chain Processing. Deadline ledger is
 * createdAtLedger + CLAIM_VOTING_WINDOW_LEDGERS until a dedicated column is indexed.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import {
  CLAIM_DEADLINE_BATCH_SIZE,
  CLAIM_VOTING_WINDOW_LEDGERS,
} from './claim-deadline.constants';
import { APPEAL_OPEN_WINDOW_LEDGERS } from './appeal-window-reminder.constants';

function mapOnChainStatus(status: string): ClaimStatus | null {
  const normalized = status.toLowerCase();
  if (normalized === 'approved') return 'APPROVED';
  if (normalized === 'rejected') return 'REJECTED';
  return null;
}

@Injectable()
export class ClaimDeadlineProcessorService {
  private readonly logger = new Logger(ClaimDeadlineProcessorService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sorobanRpc: SorobanService,
  ) {}

  /** Entry point for the BullMQ repeatable scan job. */
  async runScan(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Claim deadline scan already running — skipping tick');
      return;
    }

    this.isRunning = true;
    try {
      const network = this.config.get<string>('STELLAR_NETWORK', 'testnet');
      const cursor = await this.prisma.ledgerCursor.findUnique({ where: { network } });
      if (!cursor) {
        this.logger.warn('No ledger cursor — skipping claim deadline scan');
        return;
      }

      const currentLedger = cursor.lastProcessedLedger;
      const deadlineCutoff = currentLedger - CLAIM_VOTING_WINDOW_LEDGERS;

      const expired = await this.prisma.claim.findMany({
        where: {
          status: 'PENDING',
          isFinalized: false,
          deletedAt: null,
          createdAtLedger: { lte: deadlineCutoff },
        },
        take: CLAIM_DEADLINE_BATCH_SIZE,
        orderBy: { createdAtLedger: 'asc' },
      });

      for (const claim of expired) {
        await this.processClaim(claim.id);
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Finalize one claim on-chain and mirror status in Postgres.
   * RPC failures are logged and do not block sibling claims in the same scan.
   */
  async processClaim(claimId: number): Promise<'finalized' | 'skipped' | 'failed'> {
    const existing = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!existing || existing.isFinalized) {
      return 'skipped';
    }

    try {
      const result = await this.sorobanRpc.finalizeClaim(claimId);
      const dbStatus = mapOnChainStatus(result.onChainStatus);

      await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          isFinalized: true,
          ...(dbStatus ? { status: dbStatus } : {}),
          updatedAtLedger: result.ledger,
          txHash: result.txHash,
          // Mirror on-chain appeal_open_deadline_ledger so reminder scans can query Postgres.
          ...(dbStatus === 'REJECTED'
            ? {
                appealOpenDeadlineLedger:
                  result.ledger + APPEAL_OPEN_WINDOW_LEDGERS,
              }
            : {}),
        },
      });

      this.logger.log(
        `Finalized claim ${claimId} on-chain status=${result.onChainStatus} tx=${result.txHash}`,
      );
      return 'finalized';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('ClaimAlreadyTerminal') ||
        msg.includes('CLAIM_ALREADY_TERMINAL') ||
        msg.toLowerCase().includes('already terminal')
      ) {
        await this.prisma.claim.updateMany({
          where: { id: claimId, isFinalized: false },
          data: { isFinalized: true },
        });
        return 'skipped';
      }

      this.logger.error(
        `Claim deadline finalize failed claimId=${claimId} — manual review required: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      return 'failed';
    }
  }
}
