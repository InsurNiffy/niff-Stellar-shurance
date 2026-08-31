# Flaky Test Quarantine Process

## Detection

Both `frontend` and `backend` Jest configs load `jest.flaky-retry.js`,
which enables `jest.retryTimes(2, { logErrorsBeforeRetry: true })` when
running in CI (`process.env.CI` is set by GitHub Actions). A test that
fails once and then passes on retry is not silently green — the retry
attempt and the original failure are both logged in the CI output, and
`.github/workflows/flaky-test-report.yml` parses the Jest JSON output
(`--json --outputFile`) for any test whose `invocations` count is
greater than 1. Those tests are written to a `flaky-tests-report`
artifact and posted as a build warning annotation, so a flaky test is
flagged rather than retried forever without anyone noticing.

## Quarantining a test

1. Confirm the test is genuinely flaky (fails intermittently, not a
   real regression) — re-run it locally a handful of times, or check
   the flaky-test-report artifact from a few recent CI runs.
2. Mark it `it.skip` / `test.skip` (or `describe.skip` if the whole
   suite is affected) with a comment: `// Quarantined: see QUARANTINE.md — <issue link>`.
3. Open a tracking issue describing the symptom and suspected cause.
4. Add a row to `QUARANTINE.md` with the test name, file, date, issue
   link, and an owner responsible for fixing it.

## Un-quarantining a test

1. Fix the underlying flakiness (timing assumption, shared state,
   unmocked network call, etc.).
2. Run the test locally in a loop (e.g. `--testNamePattern` in a shell
   loop, or `jest --runInBand -t "<name>" --repeat 20` equivalent) to
   build confidence it's stable.
3. Remove the `.skip` and the quarantine comment from the test file.
4. Remove the corresponding row from `QUARANTINE.md`.
5. Close the tracking issue, linking the fixing PR.

## Guidelines

- Quarantine is a last resort to keep CI trustworthy while a fix is
  pending — it is not a way to permanently silence an inconvenient
  test. Tracking issues should stay open and visible until resolved.
- A test should not stay quarantined for more than one release cycle
  without an update on the tracking issue explaining why.
