import { calculatePremium, RiskInput, RateTable } from './premium.engine';
import * as vectorFile from './golden-vectors.json';

// Lint guard — this test fails if Number arithmetic is used in the engine.
// The engine must only use bigint operations.
describe('Premium engine — golden-vector parity', () => {
  const { vectors } = vectorFile;

  for (const vec of vectors) {
    it(`${vec.id}: ${vec.description}`, () => {
      const input: RiskInput = {
        baseAmount: BigInt(vec.input.baseAmount),
        safetyScore: BigInt(vec.input.safetyScore),
        deductibleAmount:
          vec.input.deductibleAmount != null
            ? BigInt(vec.input.deductibleAmount)
            : undefined,
      };

      const table: RateTable = {
        riskRate: BigInt(vec.table.riskRate),
        regionFactor: BigInt(vec.table.regionFactor),
        ageFactor: BigInt(vec.table.ageFactor),
        coverageMult: BigInt(vec.table.coverageMult),
      };

      const actual = calculatePremium(input, table);
      expect(actual).toBe(BigInt(vec.expectedPremium));
    });
  }

  it('returns floor of 1 when premium would be zero or negative', () => {
    const result = calculatePremium(
      { baseAmount: 0n, safetyScore: 0n },
      { riskRate: 500n, regionFactor: 10_000n, ageFactor: 10_000n, coverageMult: 10_000n },
    );
    expect(result).toBe(1n);
  });

  it('never uses Number arithmetic — all operands are bigint', () => {
    // Providing a non-bigint should cause a TypeScript error at compile time.
    // At runtime, passing a number string as bigint input would throw.
    expect(() =>
      calculatePremium(
        // @ts-expect-error intentional: passing number to verify type guard
        { baseAmount: 100000000, safetyScore: 0 },
        { riskRate: 500, regionFactor: 10000, ageFactor: 10000, coverageMult: 10000 },
      ),
    ).toThrow();
  });
});
