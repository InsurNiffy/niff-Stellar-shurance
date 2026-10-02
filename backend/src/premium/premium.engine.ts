/**
 * Premium calculation engine — integer/BigInt arithmetic only.
 * Must stay in exact parity with the on-chain Soroban contract implementation.
 *
 * Formula (mirrors contracts/niffyinsure):
 *   base_premium = base_amount * risk_rate / 10_000
 *   region_adj   = base_premium * region_factor / 10_000
 *   age_adj      = region_adj  * age_factor    / 10_000
 *   coverage_adj = age_adj     * coverage_mult / 10_000
 *   safety_disc  = coverage_adj * (10_000 - safety_score * 10n) / 10_000
 *   deductible   = deductible_amount (subtracted from premium, floor 0)
 *   premium      = max(safety_disc - deductible_amount, 1n)
 *
 * All rates are in basis points (1 bp = 0.01%).
 */

export interface RiskInput {
  /** Base coverage amount in stroops (1 XLM = 10_000_000 stroops). */
  baseAmount: bigint;
  /** Safety score 0–100: higher = bigger discount. */
  safetyScore: bigint;
  /** Optional deductible in stroops, subtracted before returning. */
  deductibleAmount?: bigint;
}

export interface RateTable {
  /** Base risk rate in basis points. */
  riskRate: bigint;
  /** Region adjustment factor in basis points. */
  regionFactor: bigint;
  /** Age band adjustment factor in basis points. */
  ageFactor: bigint;
  /** Coverage tier multiplier in basis points. */
  coverageMult: bigint;
}

const BPS = 10_000n;

export function calculatePremium(
  risk: RiskInput,
  table: RateTable,
): bigint {
  const basePremium = (risk.baseAmount * table.riskRate) / BPS;
  const regionAdj = (basePremium * table.regionFactor) / BPS;
  const ageAdj = (regionAdj * table.ageFactor) / BPS;
  const coverageAdj = (ageAdj * table.coverageMult) / BPS;

  const safetyDiscount = (coverageAdj * (BPS - risk.safetyScore * 10n)) / BPS;

  const deductible = risk.deductibleAmount ?? 0n;
  const premium = safetyDiscount - deductible;

  return premium > 0n ? premium : 1n;
}
