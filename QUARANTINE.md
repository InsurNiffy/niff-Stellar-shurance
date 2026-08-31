# Quarantined Tests

This is the tracked list of tests that have been quarantined for being
intermittently flaky (fail sometimes, pass on re-run, with no known
environment cause). See `docs/flaky-test-quarantine.md` for the full
process.

A test lands here instead of being silently skipped or endlessly
manually re-run so it stays visible until someone fixes it.

| Test | File | Quarantined on | Tracking issue | Owner |
|---|---|---|---|---|
| _(none currently)_ | | | | |

## How this list is used

- Every row here must correspond to a `.skip` (or `test.skip`) call in
  the test file with a comment linking back to the tracking issue.
- CI's flaky-detection step (see `.github/workflows/flaky-test-report.yml`)
  cross-checks tests that needed a retry to pass against this list — a
  newly-flaky test that isn't listed here shows up as a warning
  annotation on the PR so it doesn't go unnoticed.
