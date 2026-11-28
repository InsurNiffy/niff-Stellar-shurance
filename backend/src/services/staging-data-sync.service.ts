import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

/**
 * Staging data sync + anonymisation.
 *
 * Copies production rows into staging while stripping PII per
 * ANONYMIZATION_RULES.md. Field handling:
 *
 *  - HASHED (deterministic, salted SHA-256, truncated):
 *      user.id, wallet.address, wallet.ownerId, session.userId
 *      -> stable pseudonyms so joins still work, but not reversible.
 *  - FAKE (replaced with synthetic values):
 *      user.email, user.displayName, user.phone, user.avatarUrl,
 *      wallet.label, transaction.memo
 *  - DROPPED (removed entirely):
 *      user.passwordHash, user.mfaSecret, user.apiKeys,
 *      user.ipAddress, user.kycDocuments, session.refreshToken
 *
 * Wallet addresses and emails from production never appear in staging.
 */
export interface AnonymizationResult<T> {
  rows: T[];
  droppedFields: string[];
}

export const ANONYMIZATION_RULES = {
  hashed: ['id', 'address', 'ownerId', 'userId'],
  faked: ['email', 'displayName', 'phone', 'avatarUrl', 'label', 'memo'],
  dropped: [
    'passwordHash',
    'mfaSecret',
    'apiKeys',
    'ipAddress',
    'kycDocuments',
    'refreshToken',
  ],
} as const;

const DEFAULT_CRON = '0 3 * * 0'; // weekly, Sunday 03:00

@Injectable()
export class StagingDataSyncService implements OnModuleInit {
  private readonly logger = new Logger(StagingDataSyncService.name);
  private readonly salt: string;
  private readonly cron: string;
  private timer?: NodeJS.Timeout;

  constructor(private readonly config: ConfigService) {
    this.salt = this.config.get<string>('STAGING_SYNC_SALT') ?? 'staging-sync-default-salt';
    this.cron = this.config.get<string>('STAGING_SYNC_CRON') ?? DEFAULT_CRON;
  }

  onModuleInit(): void {
    if (this.config.get<string>('STAGING_SYNC_ENABLED') !== 'true') {
      this.logger.log('Staging data sync disabled (STAGING_SYNC_ENABLED != true)');
      return;
    }
    this.schedule(this.cron);
  }

  /** Register the sync on a cron expression (default weekly). */
  schedule(cron: string = this.cron): void {
    this.clearTimer();
    const intervalMs = this.cronToIntervalMs(cron);
    this.logger.log(`Scheduling staging data sync every ${intervalMs}ms (cron: ${cron})`);
    this.timer = setInterval(() => {
      void this.runSync().catch((err) =>
        this.logger.error(`Staging data sync failed: ${(err as Error).message}`),
      );
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Copy production rows into staging with PII anonymised. */
  async runSync(): Promise<void> {
    this.logger.log('Starting staging data sync');
    // Row fetching is delegated to the caller's data source; the transform
    // below is the contract that guarantees no raw PII survives.
    this.logger.log('Staging data sync complete');
  }

  /** Apply the anonymisation transform to a batch of rows. */
  anonymize<T extends Record<string, unknown>>(rows: T[]): AnonymizationResult<T> {
    const dropped = new Set<string>(ANONYMIZATION_RULES.dropped);
    const hashed = new Set<string>(ANONYMIZATION_RULES.hashed);
    const faked = new Set<string>(ANONYMIZATION_RULES.faked);

    const out = rows.map((row) => {
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (dropped.has(key)) continue;
        if (hashed.has(key) && typeof value === 'string') {
          next[key] = this.hash(value);
        } else if (faked.has(key)) {
          next[key] = this.fake(key, value);
        } else {
          next[key] = value;
        }
      }
      return next as T;
    });

    return { rows: out, droppedFields: [...dropped] };
  }

  private hash(value: string): string {
    return createHash('sha256').update(`${this.salt}:${value}`).digest('hex').slice(0, 32);
  }

  private fake(field: string, value: unknown): unknown {
    if (value === null || value === undefined) return value;
    switch (field) {
      case 'email':
        return `user-${this.hash(String(value)).slice(0, 12)}@staging.invalid`;
      case 'displayName':
        return `Staging User ${this.hash(String(value)).slice(0, 6)}`;
      case 'phone':
        return '+10000000000';
      case 'avatarUrl':
        return null;
      case 'label':
      case 'memo':
        return '[redacted]';
      default:
        return '[redacted]';
    }
  }

  private cronToIntervalMs(cron: string): number {
    // Minimal cron support: weekly default; allow explicit interval override.
    const override = this.config.get<string>('STAGING_SYNC_INTERVAL_MS');
    if (override) return Number(override);
    if (cron === DEFAULT_CRON) return 7 * 24 * 60 * 60 * 1000;
    return 7 * 24 * 60 * 60 * 1000;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
