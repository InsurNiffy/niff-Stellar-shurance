import { z } from 'zod';
import { getConfig } from '@/config/env';

// ── DTO schemas (mirrors backend/src/dto/policy.dto.ts) ──────────────────────

export const ClaimSummaryDtoSchema = z.object({
  claim_id: z.number(),
  amount: z.string(),
  status: z.enum(['Processing', 'Approved', 'Rejected']),
  approve_votes: z.number(),
  reject_votes: z.number(),
  voting_deadline_ledger: z.number().optional(),
  _link: z.string(),
});

export const PolicyDtoSchema = z.object({
  holder: z.string(),
  policy_id: z.number(),
  policy_type: z.enum(['Auto', 'Health', 'Property']),
  region: z.enum(['Low', 'Medium', 'High']),
  is_active: z.boolean(),
  coverage_summary: z.object({
    coverage_amount: z.string(),
    premium_amount: z.string(),
    currency: z.literal('XLM'),
    decimals: z.literal(7),
  }),
  expiry_countdown: z.object({
    start_ledger: z.number(),
    end_ledger: z.number(),
    ledgers_remaining: z.number(),
    avg_ledger_close_seconds: z.literal(5),
  }),
  claims: z.array(ClaimSummaryDtoSchema),
  _link: z.string(),
});

export const PolicyListDtoSchema = z.object({
  data: z.array(PolicyDtoSchema),
  next_cursor: z.string().nullable(),
  total: z.number(),
});

export type PolicyDto = z.infer<typeof PolicyDtoSchema>;
export type PolicyListDto = z.infer<typeof PolicyListDtoSchema>;
export type PolicyStatusFilter = 'active' | 'expired' | 'all';
export type PolicySortField = 'expiry' | 'coverage' | 'premium';

export interface PolicyListParams {
  holder: string;
  status?: PolicyStatusFilter;
  sort?: PolicySortField;
  after?: string;
  limit?: number;
}

export class PolicyListError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyListError';
  }
}

export async function fetchPolicies(
  params: PolicyListParams,
  signal?: AbortSignal,
): Promise<PolicyListDto> {
  const { apiUrl } = getConfig();
  const qs = new URLSearchParams({ holder: params.holder });
  if (params.status && params.status !== 'all') qs.set('status', params.status);
  if (params.after) qs.set('after', params.after);
  if (params.limit) qs.set('limit', String(params.limit));

  const res = await fetch(`${apiUrl}/api/policies?${qs}`, { signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ code: 'FETCH_FAILED', message: 'Failed to load policies' }));
    throw new PolicyListError(err.code ?? 'FETCH_FAILED', err.message ?? 'Failed to load policies');
  }
  const json: unknown = await res.json();
  const parsed = PolicyListDtoSchema.safeParse(json);
  if (!parsed.success) {
    throw new PolicyListError('PARSE_ERROR', `Invalid response: ${parsed.error.message}`);
  }
  return parsed.data;
}
