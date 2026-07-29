import { QUEUE_NAMES, QueueName } from './names';

const QUEUE_CONCURRENCY_DEFAULTS: Record<QueueName, number> = {
  'tx-submit': 1,
  'claim-events': 5,
  'claim-payouts': 3,
  'indexer': 5,
  'notifications': 5,
  'reindex': 3,
  'backfill': 3,
  'policy-renewal-reminders': 3,
  'webhooks': 5,
  'outbound-webhooks': 5,
};

export type BackoffType = 'exponential' | 'fixed';

export interface QueueRetryConfig {
  maxAttempts: number;
  backoff: { type: BackoffType; delay: number };
}

/**
 * Per-queue retry budgets — compiled defaults.
 *
 * tx-submit                  3 attempts / 2 s base — XDR submissions are fast-fail; excess
 *                            retries risk double-submission on nonce-sensitive operations.
 * claim-events               5 attempts / 1 s base — event processing is idempotent; brief
 *                            network blips are the common failure mode.
 * claim-payouts              7 attempts / 5 s base — high-value token transfers must not be
 *                            dropped; longer backoff avoids hammering an overloaded RPC node.
 * indexer                    5 attempts / 2 s base — on-chain event indexing is idempotent;
 *                            RPC blips are common, aggressive retry is safe.
 * notifications              3 attempts / 1 s base — user-facing delivery; fast-fail to avoid
 *                            stale notifications reaching users.
 * reindex / backfill         3 attempts / 2 s base — batch operations on large ranges;
 *                            retries are cheap but excess attempts delay the overall batch.
 * policy-renewal-reminders   5 attempts / 2 s base — reminders are time-sensitive; more
 *                            retries increase the chance of delivery within the window.
 * webhooks / outbound-webhooks 5 attempts / 1 s base — external delivery; exponential backoff
 *                            avoids hammering flaky subscribers.
 */
const QUEUE_RETRY_DEFAULTS: Record<QueueName, QueueRetryConfig> = {
  'tx-submit':                { maxAttempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
  'claim-events':             { maxAttempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
  'claim-payouts':            { maxAttempts: 7, backoff: { type: 'exponential', delay: 5_000 } },
  'indexer':                  { maxAttempts: 5, backoff: { type: 'exponential', delay: 2_000 } },
  'notifications':            { maxAttempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  'reindex':                  { maxAttempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
  'backfill':                 { maxAttempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
  'policy-renewal-reminders': { maxAttempts: 5, backoff: { type: 'exponential', delay: 2_000 } },
  'webhooks':                 { maxAttempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
  'outbound-webhooks':        { maxAttempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
};

/**
 * Parse QUEUE_RETRY_MAP env var into a map of queue name → QueueRetryConfig.
 *
 * Format: "queue-name=maxAttempts,backoffType,initialDelayMs;..."
 *
 * Example:
 *   QUEUE_RETRY_MAP="tx-submit=3,exponential,2000;webhooks=7,fixed,5000"
 */
function parseRetryMap(raw: string | undefined): Map<string, QueueRetryConfig> {
  const map = new Map<string, QueueRetryConfig>();
  if (!raw || !raw.trim()) return map;

  for (const entry of raw.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!name || !value) continue;

    const parts = value.split(',').map((s) => s.trim());
    if (parts.length !== 3) continue;

    const [attemptsStr, typeStr, delayStr] = parts;
    const maxAttempts = parseInt(attemptsStr, 10);
    if (isNaN(maxAttempts) || maxAttempts < 1) continue;

    const backoffType = typeStr as BackoffType;
    if (backoffType !== 'exponential' && backoffType !== 'fixed') continue;

    const delay = parseInt(delayStr, 10);
    if (isNaN(delay) || delay < 1) continue;

    map.set(name, { maxAttempts, backoff: { type: backoffType, delay } });
  }

  return map;
}

let _retryOverrides: Map<string, QueueRetryConfig> | undefined;

function getRetryOverrides(): Map<string, QueueRetryConfig> {
  if (!_retryOverrides) {
    _retryOverrides = parseRetryMap(process.env.QUEUE_RETRY_MAP);
  }
  return _retryOverrides;
}

/** Reset override cache — exposed for testing. */
export function resetRetryOverridesCache(): void {
  _retryOverrides = undefined;
}

export function getQueueRetryConfig(queueName: QueueName): QueueRetryConfig {
  const overrides = getRetryOverrides();
  return overrides.get(queueName) ?? QUEUE_RETRY_DEFAULTS[queueName];
}

export function getQueueConcurrency(
  queueName: QueueName,
  concurrencyMapStr?: string,
): number {
  if (!concurrencyMapStr) {
    return QUEUE_CONCURRENCY_DEFAULTS[queueName];
  }

  const map = new Map<string, number>();
  for (const pair of concurrencyMapStr.split(',')) {
    const [name, value] = pair.trim().split('=');
    if (name && value) {
      const concurrency = parseInt(value, 10);
      if (!isNaN(concurrency) && concurrency > 0) {
        map.set(name.trim(), concurrency);
      }
    }
  }

  return map.get(queueName) ?? QUEUE_CONCURRENCY_DEFAULTS[queueName];
}
