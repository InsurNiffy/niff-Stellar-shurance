/**
 * Canonical queue names — single source of truth.
 * Used by producers, workers, and the metrics collector.
 *
 * Key naming: BullMQ prepends the keyPrefix from ioredis config, so the
 * full Redis key for the claim-events queue in development is:
 *   development:niffyinsure:bull:claim-events:waiting
 */
export const QUEUE_NAMES = [
  "claim-events",              // Soroban event indexing → DB writes
  "claim-payouts",             // Approved claim → token transfer trigger
  "tx-submit",                 // Async XDR submission to Soroban RPC
  "indexer",                   // On-chain event indexing
  "notifications",             // Outbound user notification delivery
  "reindex",                   // Historical reindex catch-up
  "backfill",                  // Ledger-range backfill replay
  "policy-renewal-reminders",  // Renewal reminder delivery
  "webhooks",                  // Inbound webhook processing
  "outbound-webhooks",         // Outbound webhook delivery
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export const TX_SUBMIT_QUEUE = "tx-submit";
