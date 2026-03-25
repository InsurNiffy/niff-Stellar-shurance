/**
 * Canonical queue names — single source of truth.
 * Used by producers, workers, and the metrics collector.
 *
 * Key naming: BullMQ prepends the keyPrefix from ioredis config, so the
 * full Redis key for the claim-events queue in development is:
 *   development:niffyinsure:bull:claim-events:waiting
 */
export const QUEUE_NAMES = [
  "claim-events",   // Soroban event indexing → DB writes
  "claim-payouts",  // Approved claim → token transfer trigger
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];
