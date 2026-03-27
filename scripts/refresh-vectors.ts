#!/usr/bin/env ts-node
/**
 * scripts/refresh-vectors.ts
 *
 * Regenerates backend/src/soroban/golden-vectors.json from the live builders
 * in soroban.client.ts.  Run this whenever the contract ABI changes, then
 * review the diff and bump contractSemver before committing.
 *
 * Usage:
 *   cd backend
 *   npx ts-node ../scripts/refresh-vectors.ts
 *
 * Requirements:
 *   - No network access needed — vectors are derived from local SDK encoding.
 *   - Never pass real private keys or mainnet addresses.
 *
 * After running:
 *   1. git diff backend/src/soroban/golden-vectors.json
 *   2. If the ABI changed, bump "_meta.contractSemver".
 *   3. Open a PR — a second engineer must approve vector changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { nativeToScVal, xdr, Address } from '@stellar/stellar-sdk';

// ── Placeholder addresses (never real keys) ───────────────────────────────────
const PLACEHOLDER_ACCOUNT = 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW';
const PLACEHOLDER_ASSET   = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

function enumVariantToScVal(variant: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
}

function scvTypeName(val: xdr.ScVal): string {
  return val.switch().name;
}

function encodeB64(val: xdr.ScVal): string {
  return val.toXDR('base64');
}

interface ArgRecord {
  pos: number;
  name: string;
  scvType: string;
  encoding: string;
}

function buildArgRecords(names: string[], vals: xdr.ScVal[]): ArgRecord[] {
  return vals.map((v, i) => ({
    pos: i,
    name: names[i],
    scvType: scvTypeName(v),
    encoding: encodeB64(v),
  }));
}

// ── initiate_policy vectors ───────────────────────────────────────────────────

function makeInitiatePolicyVector(
  id: string,
  description: string,
  opts: {
    policyType: string;
    region: string;
    ageBand: string;
    coverageType: string;
    safetyScore: number;
    baseAmount: bigint;
  },
) {
  const vals = [
    new Address(PLACEHOLDER_ACCOUNT).toScVal(),
    enumVariantToScVal(opts.policyType),
    enumVariantToScVal(opts.region),
    enumVariantToScVal(opts.ageBand),
    enumVariantToScVal(opts.coverageType),
    nativeToScVal(opts.safetyScore, { type: 'u32' }),
    nativeToScVal(opts.baseAmount, { type: 'i128' }),
    new Address(PLACEHOLDER_ASSET).toScVal(),
  ];
  const names = ['holder','policy_type','region','age_band','coverage_type','safety_score','base_amount','asset'];
  return {
    id,
    function: 'initiate_policy',
    description,
    args: buildArgRecords(names, vals),
    argCount: vals.length,
    inputs: {
      holder:        PLACEHOLDER_ACCOUNT,
      policy_type:   opts.policyType,
      region:        opts.region,
      age_band:      opts.ageBand,
      coverage_type: opts.coverageType,
      safety_score:  opts.safetyScore,
      base_amount:   opts.baseAmount.toString(),
      asset:         PLACEHOLDER_ASSET,
    },
  };
}

// ── file_claim vector ─────────────────────────────────────────────────────────

function makeFileClaimVector() {
  const imageUrls = ['ipfs://QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'];
  const vals = [
    new Address(PLACEHOLDER_ACCOUNT).toScVal(),
    nativeToScVal(0, { type: 'u32' }),
    nativeToScVal(BigInt('1000000000'), { type: 'i128' }),
    nativeToScVal('Vehicle damage', { type: 'string' }),
    xdr.ScVal.scvVec(imageUrls.map((u) => nativeToScVal(u, { type: 'string' }))),
  ];
  const names = ['holder','policy_id','amount','details','image_urls'];
  return {
    id: 'file_claim__standard',
    function: 'file_claim',
    description: 'Standard claim filing with one image URL',
    args: buildArgRecords(names, vals),
    argCount: vals.length,
    inputs: {
      holder:     PLACEHOLDER_ACCOUNT,
      policy_id:  0,
      amount:     '1000000000',
      details:    'Vehicle damage',
      image_urls: imageUrls,
    },
  };
}

// ── vote_on_claim vector ──────────────────────────────────────────────────────

function makeVoteOnClaimVector() {
  const vals = [
    new Address(PLACEHOLDER_ACCOUNT).toScVal(),
    nativeToScVal(BigInt(0), { type: 'u64' }),
    enumVariantToScVal('Approve'),
  ];
  const names = ['voter','claim_id','vote'];
  return {
    id: 'vote_on_claim__approve',
    function: 'vote_on_claim',
    description: 'Voter casts Approve on claim 0',
    args: buildArgRecords(names, vals),
    argCount: vals.length,
    inputs: {
      voter:    PLACEHOLDER_ACCOUNT,
      claim_id: '0',
      vote:     'Approve',
    },
  };
}

// ── Assemble and write ────────────────────────────────────────────────────────

const existing = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../backend/src/soroban/golden-vectors.json'),
    'utf8',
  ),
);

const output = {
  _meta: {
    ...existing._meta,
    generatedBy: 'scripts/refresh-vectors.ts',
  },
  vectors: [
    makeInitiatePolicyVector('initiate_policy__basic', 'Standard Auto/Low/Adult/Basic policy initiation', {
      policyType: 'Auto', region: 'Low', ageBand: 'Adult', coverageType: 'Basic',
      safetyScore: 74, baseAmount: BigInt('1000000000'),
    }),
    makeInitiatePolicyVector('initiate_policy__high_risk', 'Health/High/Senior/Premium — exercises all non-default enum variants', {
      policyType: 'Health', region: 'High', ageBand: 'Senior', coverageType: 'Premium',
      safetyScore: 1, baseAmount: BigInt('5000000000'),
    }),
    makeFileClaimVector(),
    makeVoteOnClaimVector(),
  ],
  negativeVectors: existing.negativeVectors,
};

const outPath = path.resolve(__dirname, '../backend/src/soroban/golden-vectors.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(`✓ Vectors written to ${outPath}`);
console.log('  Review the diff, bump _meta.contractSemver if the ABI changed, then commit.');
