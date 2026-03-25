/**
 * Quote DTO validation tests + golden vector tests for computePremiumLocal.
 *
 * Golden vectors are derived from the Rust compute_premium implementation in
 * contracts/niffyinsure/src/premium.rs using the same integer arithmetic:
 *
 *   BASE = 10_000_000 stroops
 *   premium = BASE × (type_factor + region_factor + age_factor + risk_score) ÷ 10
 *
 *   type_factor:   Auto=15, Health=20, Property=10
 *   region_factor: Low=8,  Medium=10, High=14
 *   age_factor:    age<25 → 15 | age>60 → 13 | else → 10
 */

import { GeneratePremiumDtoSchema } from './quote.dto';
import { computePremiumLocal } from '../soroban/soroban.client';

// ── DTO validation ─────────────────────────────────────────────────────────────

describe('GeneratePremiumDtoSchema', () => {
  const valid = {
    policy_type: 'Auto',
    region: 'Low',
    age: 30,
    risk_score: 5,
  };

  it('accepts a valid payload', () => {
    expect(GeneratePremiumDtoSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing policy_type', () => {
    const { policy_type: _omit, ...rest } = valid;
    const result = GeneratePremiumDtoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid policy_type value', () => {
    const result = GeneratePremiumDtoSchema.safeParse({
      ...valid,
      policy_type: 'Life',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Auto');
    }
  });

  it('rejects invalid region value', () => {
    const result = GeneratePremiumDtoSchema.safeParse({
      ...valid,
      region: 'Coastal',
    });
    expect(result.success).toBe(false);
  });

  it('rejects risk_score = 0', () => {
    const result = GeneratePremiumDtoSchema.safeParse({
      ...valid,
      risk_score: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects risk_score = 11', () => {
    const result = GeneratePremiumDtoSchema.safeParse({
      ...valid,
      risk_score: 11,
    });
    expect(result.success).toBe(false);
  });

  it('rejects age = 0', () => {
    const result = GeneratePremiumDtoSchema.safeParse({ ...valid, age: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer risk_score', () => {
    const result = GeneratePremiumDtoSchema.safeParse({
      ...valid,
      risk_score: 5.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid source_account format', () => {
    const result = GeneratePremiumDtoSchema.safeParse({
      ...valid,
      source_account: 'not-a-key',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid source_account', () => {
    const result = GeneratePremiumDtoSchema.safeParse({
      ...valid,
      source_account: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
    });
    expect(result.success).toBe(true);
  });
});

// ── Golden vector tests ───────────────────────────────────────────────────────

describe('computePremiumLocal — golden vectors', () => {
  // Vector 1: Auto, Low, age=30 (10), risk=5
  // sum = 15 + 8 + 10 + 5 = 38
  // premium = 10_000_000 × 38 / 10 = 38_000_000 stroops
  it('Auto / Low / age 30 / risk 5 → 38_000_000 stroops', () => {
    expect(
      computePremiumLocal({ policyType: 'Auto', region: 'Low', age: 30, riskScore: 5 }),
    ).toBe(BigInt(38_000_000));
  });

  // Vector 2: Health, High, age=30 (10), risk=8
  // sum = 20 + 14 + 10 + 8 = 52
  // premium = 10_000_000 × 52 / 10 = 52_000_000 stroops
  it('Health / High / age 30 / risk 8 → 52_000_000 stroops', () => {
    expect(
      computePremiumLocal({ policyType: 'Health', region: 'High', age: 30, riskScore: 8 }),
    ).toBe(BigInt(52_000_000));
  });

  // Vector 3: Property, Medium, age=20 (<25 → 15), risk=3
  // sum = 10 + 10 + 15 + 3 = 38
  // premium = 10_000_000 × 38 / 10 = 38_000_000 stroops
  it('Property / Medium / age 20 / risk 3 → 38_000_000 stroops', () => {
    expect(
      computePremiumLocal({ policyType: 'Property', region: 'Medium', age: 20, riskScore: 3 }),
    ).toBe(BigInt(38_000_000));
  });

  // Vector 4: Auto, High, age=65 (>60 → 13), risk=10
  // sum = 15 + 14 + 13 + 10 = 52
  // premium = 10_000_000 × 52 / 10 = 52_000_000 stroops
  it('Auto / High / age 65 / risk 10 → 52_000_000 stroops', () => {
    expect(
      computePremiumLocal({ policyType: 'Auto', region: 'High', age: 65, riskScore: 10 }),
    ).toBe(BigInt(52_000_000));
  });

  // Vector 5: Property, Low, age=25 (25-60 → 10), risk=1
  // sum = 10 + 8 + 10 + 1 = 29
  // premium = 10_000_000 × 29 / 10 = 29_000_000 stroops
  it('Property / Low / age 25 / risk 1 → 29_000_000 stroops', () => {
    expect(
      computePremiumLocal({ policyType: 'Property', region: 'Low', age: 25, riskScore: 1 }),
    ).toBe(BigInt(29_000_000));
  });

  // Vector 6: Health, Medium, age=61 (>60 → 13), risk=7
  // sum = 20 + 10 + 13 + 7 = 50
  // premium = 10_000_000 × 50 / 10 = 50_000_000 stroops
  it('Health / Medium / age 61 / risk 7 → 50_000_000 stroops', () => {
    expect(
      computePremiumLocal({ policyType: 'Health', region: 'Medium', age: 61, riskScore: 7 }),
    ).toBe(BigInt(50_000_000));
  });
});
