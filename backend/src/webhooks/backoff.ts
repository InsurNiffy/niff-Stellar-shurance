/**
 * Exponential backoff retry schedule for outbound webhook deliveries (#1484).
 *
 * attempt 1 → delay 1 * base   (before retry #2)
 * attempt 2 → delay 2 * base
 * attempt 3 → delay 4 * base
 * …
 * delay is capped at `maxDelayMs`.
 */

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_BASE_DELAY_MS = 1_000;
export const DEFAULT_MAX_DELAY_MS = 32_000;

/** Delay (ms) to wait before the retry following `attempt` (1-based). */
export function backoffDelayMs(
  attempt: number,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
): number {
  if (attempt < 1) return 0;
  const exponent = Math.min(attempt - 1, 30);
  return Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
}

/**
 * Full retry schedule for `maxAttempts` total attempts — returns the delay
 * before each retry: e.g. [1000, 2000, 4000, 8000] for 5 attempts.
 */
export function computeRetrySchedule(
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
): number[] {
  const schedule: number[] = [];
  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    schedule.push(backoffDelayMs(attempt, baseDelayMs, maxDelayMs));
  }
  return schedule;
}

/** True when `attempt` has exhausted the configured budget. */
export function isExhausted(attempt: number, maxAttempts = DEFAULT_MAX_ATTEMPTS): boolean {
  return attempt >= maxAttempts;
}
