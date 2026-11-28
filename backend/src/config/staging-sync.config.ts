import { registerAs } from '@nestjs/config';

export interface AnonymizationRule {
  /** How the field is transformed before it reaches staging. */
  strategy: 'hash' | 'fake' | 'drop';
  /** Optional fake generator key used when strategy === 'fake'. */
  fake?: 'email' | 'wallet' | 'name' | 'phone' | 'uuid';
}

/**
 * Field-level anonymisation rules applied by StagingDataSyncService.
 * Mirrors ANONYMIZATION_RULES.md — keep both in sync.
 *
 * - hash: replaced with a salted SHA-256 digest (deterministic, non-reversible)
 * - fake: replaced with generated fake data of the same shape
 * - drop: column omitted entirely from the staging copy
 */
export const ANONYMIZATION_RULES: Record<string, Record<string, AnonymizationRule>> = {
  users: {
    email: { strategy: 'hash' },
    wallet_address: { strategy: 'hash' },
    display_name: { strategy: 'fake', fake: 'name' },
    phone_number: { strategy: 'fake', fake: 'phone' },
    password_hash: { strategy: 'drop' },
    mfa_secret: { strategy: 'drop' },
    refresh_token_hash: { strategy: 'drop' },
  },
  transactions: {
    from_wallet: { strategy: 'hash' },
    to_wallet: { strategy: 'hash' },
    memo: { strategy: 'drop' },
  },
  audit_logs: {
    actor_email: { strategy: 'hash' },
    ip_address: { strategy: 'drop' },
    user_agent: { strategy: 'drop' },
  },
};

export default registerAs('stagingSync', () => ({
  enabled: process.env.STAGING_SYNC_ENABLED === 'true',
  /** Cron expression; defaults to weekly (Sunday 02:00). */
  cron: process.env.STAGING_SYNC_CRON ?? '0 2 * * 0',
  sourceDatabaseUrl: process.env.STAGING_SYNC_SOURCE_DB_URL ?? '',
  targetDatabaseUrl: process.env.STAGING_SYNC_TARGET_DB_URL ?? '',
  /** Salt used for deterministic hashing of PII fields. */
  hashSalt: process.env.STAGING_SYNC_HASH_SALT ?? '',
  /** Tables copied during the sync; each must have a rule entry above. */
  tables: (process.env.STAGING_SYNC_TABLES ?? 'users,transactions,audit_logs')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
  batchSize: Number(process.env.STAGING_SYNC_BATCH_SIZE ?? 500),
}));
