/**
 * Retries a failing test up to twice in CI and logs each retry so a test
 * that only passes on retry shows up clearly in CI output instead of being
 * silently re-run forever. See ../QUARANTINE.md for the flaky-test
 * tracking process — a test that keeps needing retries should be
 * quarantined there, not left to rely on this safety net indefinitely.
 */
if (process.env.CI && typeof jest.retryTimes === 'function') {
  jest.retryTimes(2, { logErrorsBeforeRetry: true });
}
