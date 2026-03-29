import { HorizonOperationRecord } from "../dto/horizon-transaction.dto";

/**
 * Operation types that are relevant to the niffyinsure frontend.
 * DEX operations, account management, and claimable-balance ops are excluded.
 *
 * Horizon type_int reference:
 *   0  create_account
 *   1  payment
 *   2  path_payment_strict_receive
 *   13 path_payment_strict_send
 *   8  change_trust
 *   9  allow_trust
 *   10 account_merge
 */
const ALLOWED_OPERATION_TYPES = new Set([
  "payment",
  "path_payment_strict_receive",
  "path_payment_strict_send",
  "create_account",
]);

/**
 * Strip all Horizon fields not required by the frontend and filter to relevant
 * operation types only. This function never throws — malformed records are
 * silently skipped.
 */
export function filterHorizonOperations(
  rawRecords: Record<string, unknown>[],
): HorizonOperationRecord[] {
  const results: HorizonOperationRecord[] = [];

  for (const record of rawRecords) {
    const type = record["type"] as string | undefined;
    if (!type || !ALLOWED_OPERATION_TYPES.has(type)) {
      continue;
    }

    const filtered: HorizonOperationRecord = {
      id: String(record["id"] ?? ""),
      paging_token: String(record["paging_token"] ?? ""),
      type,
      type_int: Number(record["type_int"] ?? 0),
      created_at: String(record["created_at"] ?? ""),
      transaction_hash: String(record["transaction_hash"] ?? ""),
      transaction_successful: Boolean(record["transaction_successful"] ?? true),
      source_account: String(record["source_account"] ?? ""),
    };

    // Optional payment fields — only include when present
    if (record["asset_type"]) filtered.asset_type = String(record["asset_type"]);
    if (record["asset_code"]) filtered.asset_code = String(record["asset_code"]);
    if (record["asset_issuer"]) filtered.asset_issuer = String(record["asset_issuer"]);
    if (record["amount"]) filtered.amount = String(record["amount"]);
    if (record["from"]) filtered.from = String(record["from"]);
    if (record["to"]) filtered.to = String(record["to"]);

    results.push(filtered);
  }

  return results;
}
