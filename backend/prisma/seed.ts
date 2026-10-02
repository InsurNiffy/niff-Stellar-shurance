/**
 * Prisma seed script — deterministic dev data.
 *
 * Run with: npm run db:seed
 *
 * Creates a dev admin user and a handful of representative policies/claims so
 * the local environment starts with something to look at.  All inserted rows
 * use deterministic wallet addresses and fixed IDs so re-running is idempotent
 * (upsert semantics throughout).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_HOLDER = 'GCDEV0000000000000000000000000000000000000000000000000001';
const DEV_HOLDER2 = 'GCDEV0000000000000000000000000000000000000000000000000002';
const DEV_ASSET = 'USDC_ISSUER_TESTNET';
const BASE_LEDGER = 1_000_000;

async function main() {
  // ── HolderProfile ────────────────────────────────────────────────────────
  await prisma.holderProfile.upsert({
    where: { walletAddress: DEV_HOLDER },
    update: {},
    create: {
      walletAddress: DEV_HOLDER,
      displayName: 'Dev Holder 1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  });

  await prisma.holderProfile.upsert({
    where: { walletAddress: DEV_HOLDER2 },
    update: {},
    create: {
      walletAddress: DEV_HOLDER2,
      displayName: 'Dev Holder 2',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  });

  // ── Policy ───────────────────────────────────────────────────────────────
  const policy1Id = `${DEV_HOLDER}:1`;
  await prisma.policy.upsert({
    where: { id: policy1Id },
    update: {},
    create: {
      id: policy1Id,
      holderAddress: DEV_HOLDER,
      policyType: 'AUTO',
      coverage: '1000000',
      premium: '10000',
      asset: DEV_ASSET,
      startLedger: BASE_LEDGER,
      endLedger: BASE_LEDGER + 1_000_000,
      isActive: true,
      createdAtLedger: BASE_LEDGER,
    },
  });

  const policy2Id = `${DEV_HOLDER2}:1`;
  await prisma.policy.upsert({
    where: { id: policy2Id },
    update: {},
    create: {
      id: policy2Id,
      holderAddress: DEV_HOLDER2,
      policyType: 'HEALTH',
      coverage: '500000',
      premium: '8000',
      asset: DEV_ASSET,
      startLedger: BASE_LEDGER,
      endLedger: BASE_LEDGER + 1_000_000,
      isActive: true,
      createdAtLedger: BASE_LEDGER,
    },
  });

  // ── Claim ────────────────────────────────────────────────────────────────
  await prisma.claim.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      policyId: policy1Id,
      creatorAddress: DEV_HOLDER,
      amount: '200000',
      asset: DEV_ASSET,
      description: 'Dev seed claim — auto policy',
      status: 'APPROVED',
      isFinalized: true,
      approveVotes: 3,
      rejectVotes: 0,
      createdAtLedger: BASE_LEDGER + 100,
    },
  });

  await prisma.claim.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      policyId: policy2Id,
      creatorAddress: DEV_HOLDER2,
      amount: '50000',
      asset: DEV_ASSET,
      description: 'Dev seed claim — health policy, pending',
      status: 'PENDING',
      isFinalized: false,
      approveVotes: 0,
      rejectVotes: 0,
      createdAtLedger: BASE_LEDGER + 200,
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
