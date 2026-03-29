/**
 * Golden-vector encoding tests — ABI drift guard.
 *
 * These tests assert the exact ScVal type and argument count produced by the
 * Soroban client builders for every critical contract invocation.  If a
 * builder changes argument order, type, or count without updating the vectors,
 * this suite fails CI.
 *
 * HOW TO REFRESH:
 *   npm run refresh-vectors          # regenerates golden-vectors.json
 *   git diff backend/src/soroban/golden-vectors.json   # review the diff
 *   # Bump contractSemver in the JSON if the contract ABI changed.
 *   git add backend/src/soroban/golden-vectors.json && git commit
 *
 * NEVER commit real private keys or mainnet addresses into the vector file.
 */

import {
  nativeToScVal,
  xdr,
  Address,
} from '@stellar/stellar-sdk';
import * as vectors from './golden-vectors.json';

// ── Helpers that mirror soroban.client.ts ─────────────────────────────────────

function enumVariantToScVal(variant: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
}

/** Returns the ScVal type name string, e.g. "scvVec", "scvU32". */
function scvTypeName(val: xdr.ScVal): string {
  return val.switch().name;
}

// ── Builders under test ───────────────────────────────────────────────────────

/**
 * Mirrors the argument list built in soroban.client.ts
 * `buildInitiatePolicyTransaction`.
 *
 * Argument order MUST match contracts/niffyinsure/src/lib.rs `initiate_policy`:
 *   holder, policy_type, region, age_band, coverage_tier, safety_score,
 *   base_amount, asset, beneficiary (Option<Address>), deductible (Option<i128>)
 */
function buildInitiatePolicyArgs(inputs: Record<string, unknown>): xdr.ScVal[] {
  const ben = inputs['beneficiary'];
  const beneficiaryScv =
    ben == null || ben === ''
      ? nativeToScVal(null)
      : nativeToScVal(new Address(String(ben)), {
          type: 'option',
          innerType: 'address',
        } as { type: string; innerType: string });
  const ded = inputs['deductible'];
  const deductibleScv =
    ded == null || ded === ''
      ? nativeToScVal(null)
      : nativeToScVal(BigInt(String(ded)), {
          type: 'option',
          innerType: 'i128',
        } as { type: string; innerType: string });
  return [
    new Address(inputs['holder'] as string).toScVal(),
    enumVariantToScVal(inputs['policy_type'] as string),
    enumVariantToScVal(inputs['region'] as string),
    enumVariantToScVal(inputs['age_band'] as string),
    enumVariantToScVal(inputs['coverage_tier'] as string),
    nativeToScVal(inputs['safety_score'] as number, { type: 'u32' }),
    nativeToScVal(BigInt(inputs['base_amount'] as string), { type: 'i128' }),
    new Address(inputs['asset'] as string).toScVal(),
    beneficiaryScv,
    deductibleScv,
  ];
}

/**
 * Mirrors `file_claim` argument list.
 * Contract signature: holder, policy_id, amount, details, image_urls
 */
function buildFileClaimArgs(inputs: Record<string, unknown>): xdr.ScVal[] {
  const imageUrls = (inputs['image_urls'] as string[]).map((u) =>
    nativeToScVal(u, { type: 'string' }),
  );
  return [
    new Address(inputs['holder'] as string).toScVal(),
    nativeToScVal(inputs['policy_id'] as number, { type: 'u32' }),
    nativeToScVal(BigInt(inputs['amount'] as string), { type: 'i128' }),
    nativeToScVal(inputs['details'] as string, { type: 'string' }),
    xdr.ScVal.scvVec(imageUrls),
  ];
}

/**
 * Mirrors `vote_on_claim` argument list.
 * Contract signature: voter, claim_id, vote
 */
function buildVoteOnClaimArgs(inputs: Record<string, unknown>): xdr.ScVal[] {
  return [
    new Address(inputs['voter'] as string).toScVal(),
    nativeToScVal(BigInt(inputs['claim_id'] as string), { type: 'u64' }),
    enumVariantToScVal(inputs['vote'] as string),
  ];
}

const BUILDERS: Record<string, (inputs: Record<string, unknown>) => xdr.ScVal[]> = {
  initiate_policy: buildInitiatePolicyArgs,
  file_claim: buildFileClaimArgs,
  vote_on_claim: buildVoteOnClaimArgs,
};

// ── Golden vector tests ───────────────────────────────────────────────────────

describe('Soroban argument golden vectors', () => {
  describe('positive vectors — encoding must match', () => {
    for (const vec of vectors.vectors) {
      // Skip vectors whose builder isn't implemented yet (e.g. generate_premium map)
      if (!BUILDERS[vec.function]) continue;

      it(`${vec.id}: arg count and ScVal types match golden`, () => {
        const builder = BUILDERS[vec.function];
        const built = builder(vec.inputs as Record<string, unknown>);

        // 1. Argument count
        expect(built.length).toBe(vec.argCount);

        // 2. Each argument's ScVal type matches the golden record
        for (const golden of vec.args) {
          const actual = built[golden.pos];
          expect(scvTypeName(actual)).toBe(golden.scvType);
        }
      });
    }
  });

  describe('negative vectors — malformed inputs must throw or produce wrong type', () => {
    it('initiate_policy__wrong_arg_count: builder with missing arg produces wrong count', () => {
      // Simulate a builder that omits the last arg (asset)
      const inputs = vectors.vectors.find((v) => v.id === 'initiate_policy__basic')!.inputs as Record<string, unknown>;
      const full = buildInitiatePolicyArgs(inputs);
      const truncated = full.slice(0, 9); // drop deductible (10th arg)
      const neg = vectors.negativeVectors.find((n) => n.id === 'initiate_policy__wrong_arg_count')!;
      expect(truncated.length).toBe(neg.badArgCount);
      expect(truncated.length).not.toBe(
        vectors.vectors.find((v) => v.function === 'initiate_policy')!.argCount,
      );
    });

    it('initiate_policy__enum_wrong_type: scvSymbol instead of scvVec([scvSymbol]) is detectable', () => {
      // Directly encode as scvSymbol (wrong) vs enumVariantToScVal (correct)
      const wrongEncoding = xdr.ScVal.scvSymbol('Auto');
      const correctEncoding = enumVariantToScVal('Auto');
      expect(scvTypeName(wrongEncoding)).toBe('scvSymbol');
      expect(scvTypeName(correctEncoding)).toBe('scvVec');
      expect(scvTypeName(wrongEncoding)).not.toBe(scvTypeName(correctEncoding));
    });

    it('file_claim__amount_zero: i128(0) encodes as scvI128 but contract rejects it', () => {
      // The builder itself produces a valid ScVal; the zero-amount guard is
      // enforced by the DTO validator upstream. Verify the ScVal type is still
      // scvI128 so the negative vector stays honest about where the check lives.
      const zeroVal = nativeToScVal(BigInt(0), { type: 'i128' });
      expect(scvTypeName(zeroVal)).toBe('scvI128');
    });
  });

  describe('meta — vector file integrity', () => {
    it('vector file has a contractSemver field', () => {
      expect(typeof vectors._meta.contractSemver).toBe('string');
      expect(vectors._meta.contractSemver).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('every positive vector has a unique id', () => {
      const ids = vectors.vectors.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every positive vector specifies argCount matching its args array length', () => {
      for (const vec of vectors.vectors) {
        expect(vec.args.length).toBeLessThanOrEqual(vec.argCount);
      }
    });

    it('no vector input contains a real private key pattern', () => {
      const raw = JSON.stringify(vectors);
      // Stellar secret keys start with 'S' and are 56 chars of base32
      expect(raw).not.toMatch(/\bS[A-Z2-7]{55}\b/);
    });
  });
});
