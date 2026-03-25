/**
 * Policy bind DTOs.
 *
 * Schemas align with the contract argument ordering for initiate_policy:
 *   holder, policy_type, region, coverage, age, risk_score,
 *   start_ledger (optional), duration_ledgers (optional)
 *
 * Coverage is accepted as a string to handle i128 values safely in JSON.
 * The service converts it to BigInt before passing to the Soroban encoder.
 */

import { z } from 'zod';

const PolicyTypeSchema = z.enum(['Auto', 'Health', 'Property'], {
  errorMap: () => ({
    message: "policy_type must be one of: 'Auto', 'Health', 'Property'",
  }),
});

const RegionTierSchema = z.enum(['Low', 'Medium', 'High'], {
  errorMap: () => ({
    message: "region must be one of: 'Low', 'Medium', 'High'",
  }),
});

export const BuildTransactionDtoSchema = z.object({
  /**
   * Stellar public key of the policyholder.
   * Must be a funded testnet/mainnet account (needed to retrieve sequence number).
   */
  holder: z
    .string()
    .regex(
      /^G[A-Z2-7]{55}$/,
      'holder must be a valid Stellar public key (G...)',
    ),

  policy_type: PolicyTypeSchema,
  region: RegionTierSchema,

  /**
   * Maximum claim payout in stroops, as a decimal string.
   * Example: "1000000000" (100 XLM).  Must be > 0.
   * Use strings to avoid JSON number precision loss with large i128 values.
   */
  coverage: z
    .string()
    .regex(/^\d+$/, 'coverage must be a positive integer string (stroops)')
    .refine((v) => BigInt(v) > BigInt(0), {
      message: 'coverage must be greater than 0',
    }),

  age: z
    .number()
    .int('age must be an integer')
    .min(1, 'age must be at least 1')
    .max(120, 'age must be at most 120'),

  risk_score: z
    .number()
    .int('risk_score must be an integer')
    .min(1, 'risk_score must be between 1 and 10')
    .max(10, 'risk_score must be between 1 and 10'),

  /**
   * Ledger sequence at which the policy should start.
   * If omitted, defaults to the current ledger returned by the RPC.
   */
  start_ledger: z
    .number()
    .int()
    .positive()
    .optional(),

  /**
   * Policy duration in ledgers.  One ledger ≈ 5 s on Stellar mainnet.
   * Defaults to 1_051_200 ≈ 1 year (365 × 24 × 720 ledgers/hr).
   */
  duration_ledgers: z
    .number()
    .int()
    .positive()
    .max(2_102_400, 'duration_ledgers may not exceed 2 years')
    .optional(),
});

export type BuildTransactionDto = z.infer<typeof BuildTransactionDtoSchema>;
