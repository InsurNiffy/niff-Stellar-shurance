/**
 * Quote service DTOs.
 *
 * Zod schemas mirror the contract types in:
 *   contracts/niffyinsure/src/types.rs  (PolicyType, RegionTier)
 *   contracts/niffyinsure/src/premium.rs (compute_premium constraints)
 *
 * Validation here prevents invalid inputs from ever reaching the Soroban RPC.
 * Risk score 1-10 matches the comment in premium.rs.
 */

import { z } from 'zod';

export const PolicyTypeSchema = z.enum(['Auto', 'Health', 'Property'], {
  errorMap: () => ({
    message: "policy_type must be one of: 'Auto', 'Health', 'Property'",
  }),
});

export const RegionTierSchema = z.enum(['Low', 'Medium', 'High'], {
  errorMap: () => ({
    message: "region must be one of: 'Low', 'Medium', 'High'",
  }),
});

export const GeneratePremiumDtoSchema = z.object({
  /** Insurance coverage category. */
  policy_type: PolicyTypeSchema,
  /** Geographic risk tier. */
  region: RegionTierSchema,
  /**
   * Policyholder age in years.
   * Age buckets in premium.rs: <25 → high-risk; 25-60 → standard; >60 → senior.
   */
  age: z
    .number()
    .int('age must be an integer')
    .min(1, 'age must be at least 1')
    .max(120, 'age must be at most 120'),
  /**
   * Risk score 1–10 (higher = riskier).
   * Directly added to the factor sum in compute_premium.
   */
  risk_score: z
    .number()
    .int('risk_score must be an integer')
    .min(1, 'risk_score must be between 1 and 10')
    .max(10, 'risk_score must be between 1 and 10'),
  /**
   * Stellar public key of the account that will sign any follow-up transaction.
   * Required for simulation (to retrieve sequence number).
   * Optional when falling back to local computation.
   */
  source_account: z
    .string()
    .regex(
      /^G[A-Z2-7]{55}$/,
      'source_account must be a valid Stellar public key (G...)',
    )
    .optional(),
});

export type GeneratePremiumDto = z.infer<typeof GeneratePremiumDtoSchema>;
