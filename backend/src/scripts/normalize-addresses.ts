/**
 * Address normalization script for tracked address data.
 * Normalizes M-addresses in existing DB rows to their canonical G-address form.
 *
 * Usage (dry-run): npx ts-node -r tsconfig-paths/register src/scripts/normalize-addresses.ts --dry-run
 * Usage (apply):   npx ts-node -r tsconfig-paths/register src/scripts/normalize-addresses.ts
 */

import { PrismaClient } from '@prisma/client';
import { tryNormalizeAddress } from '../common/utils/normalize-address';

const prisma = new PrismaClient();
const isDryRun = process.argv.includes('--dry-run');

async function run() {
  console.log(`[normalize-addresses] Starting address normalization (${isDryRun ? 'dry-run' : 'apply'})...`);

  let totalDrift = 0;

  const policies = await prisma.policy.findMany({ select: { id: true, holderAddress: true } });
  let policyFixed = 0;
  for (const p of policies) {
    const normalized = tryNormalizeAddress(p.holderAddress);
    if (normalized && normalized !== p.holderAddress) {
      if (!isDryRun) {
        await prisma.policy.update({ where: { id: p.id }, data: { holderAddress: normalized } });
      }
      policyFixed++;
      totalDrift++;
    }
  }
  console.log(`[normalize-addresses] Policies: ${policyFixed} denormalized/${policies.length} total`);

  const claims = await prisma.claim.findMany({ select: { id: true, creatorAddress: true } });
  let claimFixed = 0;
  for (const c of claims) {
    const normalized = tryNormalizeAddress(c.creatorAddress);
    if (normalized && normalized !== c.creatorAddress) {
      if (!isDryRun) {
        await prisma.claim.update({ where: { id: c.id }, data: { creatorAddress: normalized } });
      }
      claimFixed++;
      totalDrift++;
    }
  }
  console.log(`[normalize-addresses] Claims: ${claimFixed} denormalized/${claims.length} total`);

  const votes = await prisma.vote.findMany({ select: { id: true, voterAddress: true } });
  let voteFixed = 0;
  for (const v of votes) {
    const normalized = tryNormalizeAddress(v.voterAddress);
    if (normalized && normalized !== v.voterAddress) {
      if (!isDryRun) {
        await prisma.vote.update({ where: { id: v.id }, data: { voterAddress: normalized } });
      }
      voteFixed++;
      totalDrift++;
    }
  }
  console.log(`[normalize-addresses] Votes: ${voteFixed} denormalized/${votes.length} total`);

  if (isDryRun && totalDrift > 0) {
    console.error(`[normalize-addresses] ❌ Dry-run detected ${totalDrift} denormalized addresses`);
    console.error('[normalize-addresses] Fix: run "npx ts-node -r tsconfig-paths/register src/scripts/normalize-addresses.ts" to normalize');
    process.exit(1);
  }

  if (isDryRun) {
    console.log('[normalize-addresses] ✓ All addresses are normalized');
  } else {
    console.log(`[normalize-addresses] ✓ Fixed ${totalDrift} denormalized addresses`);
  }
}

run()
  .catch((err) => { console.error('[normalize-addresses] Error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
