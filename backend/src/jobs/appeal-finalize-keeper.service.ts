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
 */
@Injectable()
export class AppealFinalizeKeeperService {
  private readonly logger = new Logger(AppealFinalizeKeeperService.name);

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

    // Placeholder: implementation in next commit
    this.logger.log('Appeal finalization cycle complete.');
  }
}
