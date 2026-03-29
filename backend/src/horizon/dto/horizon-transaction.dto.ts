/**
 * Horizon Transaction DTOs
 *
 * Fields forwarded from Horizon and why:
 *
 * FORWARDED:
 *   id                  — unique operation identifier; used by frontend for deduplication
 *   paging_token        — cursor for paginated fetches
 *   type                — operation type string (e.g. "payment", "change_trust")
 *   type_int            — numeric type; easier for frontend switch/case
 *   created_at          — ISO timestamp of the ledger close containing this operation
 *   transaction_hash    — links operation to its parent transaction; shown in explorer links
 *   transaction_successful — guards UI from displaying failed operations as completed
 *   source_account      — sender address
 *   asset_type          — "native" | "credit_alphanum4" | "credit_alphanum12"
 *   asset_code          — token ticker (undefined for XLM)
 *   asset_issuer        — issuer address (undefined for XLM)
 *   amount              — transfer amount as string (Stellar uses string to avoid float loss)
 *   from / to           — payment parties
 *
 * STRIPPED:
 *   _links              — Horizon HAL links; internal navigation not needed by frontend
 *   records[].links     — same reason
 *   funder / account    — create_account-specific; not used in payment history view
 *   starting_balance    — create_account-specific
 *   offer_id            — DEX offer internals; not relevant to policy-payment history
 *   price / price_r     — DEX pricing fields
 *   buying_* / selling_* — DEX asset pair fields
 *   claimable_balance_id — claimable-balance internals
 *   sponsor             — reserve-sponsoring; not displayed in current UI
 *   bump_to             — bump_sequence internals
 *   authorize*          — change_trust flag fields
 *   limit               — change_trust limit; not shown
 *   set_flags* / clear_flags* — account flags
 *   home_domain / thresholds / signers / inflation_dest — account meta changes
 *
 * HORIZON FINALITY LAG:
 *   Stellar closes a ledger approximately every 5 seconds. The `created_at` field
 *   reflects ledger close time, not submission time. Operations are final once
 *   included in a closed ledger — there is no probabilistic finality.
 *   However, Horizon ingestion may lag 1–3 ledgers (~5–15 seconds) behind the
 *   network tip. The frontend should show a "transactions may take up to 15 seconds
 *   to appear" notice and avoid treating a missing transaction as definitively
 *   failed until at least 30 seconds have elapsed.
 */

export interface HorizonOperationRecord {
  id: string;
  paging_token: string;
  type: string;
  type_int: number;
  created_at: string;
  transaction_hash: string;
  transaction_successful: boolean;
  source_account: string;
  // Payment / path-payment fields (optional — only present on relevant types)
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  from?: string;
  to?: string;
}

export interface HorizonTransactionResponse {
  records: HorizonOperationRecord[];
  next_cursor?: string;
}