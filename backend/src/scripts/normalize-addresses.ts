/**
 * One-time script: normalize M-addresses in existing DB rows.
 * Run before the NormalizeWalletAddresses migration in CI.
 *
 * Usage: npx ts-node -r tsconfig-paths/register src/scripts/normalize-addresses.ts
 */

import { PrismaClient } from '@prisma/client';
import { tryNormalizeAddress } from '../common/utils/normalize-address';

const prisma = new PrismaClient();

async function run() {
  console.log('[normalize-addresses] Starting address normalization...');

  const policies = await prisma.policy.findMany({ select: { id: true, holderAddress: true } });
  let policyFixed = 0;
  for (const p of policies) {
    const normalized = tryNormalizeAddress(p.holderAddress);
    if (normalized && normalized !== p.holderAddress) {
      await prisma.policy.update({ where: { id: p.id }, data: { holderAddress: normalized } });
      policyFixed++;
    }
  }
  console.log(`[normalize-addresses] Policies fixed: ${policyFixed}/${policies.length}`);

  const claims = await prisma.claim.findMany({ select: { id: true, creatorAddress: true } });
  let claimFixed = 0;
  for (const c of claims) {
    const normalized = tryNormalizeAddress(c.creatorAddress);
    if (normalized && normalized !== c.creatorAddress) {
      await prisma.claim.update({ where: { id: c.id }, data: { creatorAddress: normalized } });
      claimFixed++;
    }
  }
  console.log(`[normalize-addresses] Claims fixed: ${claimFixed}/${claims.length}`);

  const votes = await prisma.vote.findMany({ select: { id: true, voterAddress: true } });
  let voteFixed = 0;
  for (const v of votes) {
    const normalized = tryNormalizeAddress(v.voterAddress);
    if (normalized && normalized !== v.voterAddress) {
      await prisma.vote.update({ where: { id: v.id }, data: { voterAddress: normalized } });
      voteFixed++; 
    }
  }
  console.log(`[normalize-addresses] Votes fixed: ${voteFixed}/${votes.length}`);
  console.log('[normalize-addresses] Done.');
}

run()
  .catch((err) => { console.error('[normalize-addresses] Error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
