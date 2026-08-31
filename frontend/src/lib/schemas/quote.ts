import { z } from 'zod'

// Mirrors backend/src/quote/dto/generate-premium.dto.ts
export const QuoteFormSchema = z.object({
  policy_type: z.enum(['Auto', 'Health', 'Property'], {
    message: 'Please select a policy type',
  }),
  region: z.enum(['Low', 'Medium', 'High'], {
    message: 'Please select a region risk tier',
  }),
  coverage_tier: z.enum(['Basic', 'Standard', 'Premium'], {
    message: 'Please select a coverage tier',
  }),
  age: z
    .number({ error: 'Age is required' })
    .int('Age must be a whole number')
    .min(1, 'Age must be at least 1')
    .max(120, 'Age must be at most 120'),
  risk_score: z
    .number({ error: 'Risk score is required' })
    .int('Risk score must be a whole number')
    .min(1, 'Risk score must be between 1 and 10')
    .max(10, 'Risk score must be between 1 and 10'),
  source_account: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar public key (G...)')
    .optional()
    .or(z.literal('')),
})

export type QuoteFormData = z.infer<typeof QuoteFormSchema>

// Response from POST /quote/generate-premium
export const QuoteResponseSchema = z.object({
  premiumStroops: z.string(),
  premiumXlm: z.string(),
  minResourceFee: z.string(),
  protocolFeeBps: z.number().optional().default(500),
  source: z.enum(['simulation', 'local_fallback']),
  tokenSymbol: z.string().optional(),
  tokenDecimals: z.number().optional(),
  inputs: z.object({
    policy_type: z.string(),
    region: z.string(),
    age: z.number(),
    risk_score: z.number(),
  }),
})

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>
