/**
 * In-memory lastSeenAt throttle (#1485).
 *
 * Guarantees at most one lastSeenAt write per user per 5 minutes, even across
 * multiple authenticated requests. State is per-process: a missed update after
 * a restart is harmless because lastSeenAt is best-effort telemetry.
 */

export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

const lastTouchedAt = new Map<string, number>();

/**
 * Returns true when walletAddress is due for a lastSeenAt update, recording
 * the touch when it is. Subsequent calls within 5 minutes return false.
 */
export function shouldTouchLastSeen(
  walletAddress: string,
  now: number = Date.now(),
): boolean {
  const previous = lastTouchedAt.get(walletAddress);
  if (previous !== undefined && now - previous < LAST_SEEN_THROTTLE_MS) {
    return false;
  }
  lastTouchedAt.set(walletAddress, now);
  return true;
}

/** Test helper — clears recorded touches. */
export function _resetLastSeenThrottle(): void {
  lastTouchedAt.clear();
}
