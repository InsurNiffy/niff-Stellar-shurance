import { z } from 'zod'

export const PolicyInitiationSchema = z.object({
  quoteId: z.string().min(1, 'Quote ID is required'),
  coverageTier: z.enum(['Basic', 'Standard', 'Premium'], { message: 'Please select a coverage tier' }),
  walletAddress: z.string()
    .min(1, 'Wallet address is required')
    .regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address format'),
  beneficiaryAddress: z.string()
    .regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address format')
    .optional()
    .or(z.literal('')),
  acceptTerms: z.boolean().refine(val => val === true, 'You must accept the terms and conditions'),
})

export type PolicyInitiationData = z.infer<typeof PolicyInitiationSchema>

export const TransactionSchema = z.object({
  transactionId: z.string(),
  transactionXdr: z.string(),
  fee: z.number(),
  network: z.enum(['TESTNET', 'PUBLIC']),
  expiresAt: z.string(),
})

export type Transaction = z.infer<typeof TransactionSchema>

export const PolicySchema = z.object({
  id: z.string(),
  policyId: z.string(),
  quoteId: z.string(),
  walletAddress: z.string(),
  status: z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'CLAIMED']),
  coverageAmount: z.number(),
  premium: z.number(),
  currency: z.string(),
  startsAt: z.string(),
  expiresAt: z.string(),
  transactionHash: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Payout destination when set on-chain (G...); absent if payouts go to the holder. */
  beneficiaryAddress: z.string().optional().nullable(),
})

export type Policy = z.infer<typeof PolicySchema>

export const PolicyErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
})

export type PolicyError = z.infer<typeof PolicyErrorSchema>
