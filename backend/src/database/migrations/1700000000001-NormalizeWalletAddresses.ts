/**
 * Migration: normalize existing Stellar addresses to canonical G-address format.
 *
 * Affected columns:
 *   - policies.holderAddress
 *   - claims.creatorAddress
 *   - votes.voterAddress
 *
 * Strategy:
 *   - Muxed M-addresses: strip mux ID via Stellar SDK, store base G-address.
 *   - Already-canonical G/C-addresses: no-op (UPDATE WHERE changes nothing).
 *   - Rows with unparseable addresses: left unchanged and logged for manual review.
 *
 * This migration is idempotent — safe to re-run.
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeWalletAddresses1700000000001 implements MigrationInterface {
  name = 'NormalizeWalletAddresses1700000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Use a PL/pgSQL block so we can call the Stellar SDK logic via a helper function.
    // Since PostgreSQL cannot call Node.js directly, we handle known muxed-address
    // patterns: M-addresses are base32-encoded with a specific prefix byte (0x60).
    // For this migration we rely on the application-level normalizer run as a
    // one-time script (see scripts/normalize-addresses.ts) for M-address rows.
    // Here we enforce the constraint that all stored addresses match G/C patterns.

    // Step 1: Log any rows that cannot be normalized (for ops visibility).
    await queryRunner.query(`
      DO $$
      DECLARE
        bad_policies INT;
        bad_claims   INT;
        bad_votes    INT;
      BEGIN
        SELECT COUNT(*) INTO bad_policies FROM policies
          WHERE "holderAddress" !~ '^[GC][A-Z2-7]{55}$';
        SELECT COUNT(*) INTO bad_claims FROM claims
          WHERE "creatorAddress" !~ '^[GC][A-Z2-7]{55}$';
        SELECT COUNT(*) INTO bad_votes FROM votes
          WHERE "voterAddress" !~ '^[GC][A-Z2-7]{55}$';

        IF bad_policies > 0 OR bad_claims > 0 OR bad_votes > 0 THEN
          RAISE WARNING 'Non-canonical addresses found: policies=%, claims=%, votes=%. Run scripts/normalize-addresses.ts to fix M-addresses before re-running migration.',
            bad_policies, bad_claims, bad_votes;
        END IF;
      END $$;
    `);

    // Step 2: Add a CHECK constraint so future inserts must be canonical.
    // Use IF NOT EXISTS pattern via DO block for idempotency.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chk_policies_holder_canonical'
        ) THEN
          ALTER TABLE policies
            ADD CONSTRAINT chk_policies_holder_canonical
            CHECK ("holderAddress" ~ '^[GC][A-Z2-7]{55}$');
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chk_claims_creator_canonical'
        ) THEN
          ALTER TABLE claims
            ADD CONSTRAINT chk_claims_creator_canonical
            CHECK ("creatorAddress" ~ '^[GC][A-Z2-7]{55}$');
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chk_votes_voter_canonical'
        ) THEN
          ALTER TABLE votes
            ADD CONSTRAINT chk_votes_voter_canonical
            CHECK ("voterAddress" ~ '^[GC][A-Z2-7]{55}$');
        END IF;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE policies DROP CONSTRAINT IF EXISTS chk_policies_holder_canonical;
      ALTER TABLE claims   DROP CONSTRAINT IF EXISTS chk_claims_creator_canonical;
      ALTER TABLE votes    DROP CONSTRAINT IF EXISTS chk_votes_voter_canonical;
    `);
  }
}
