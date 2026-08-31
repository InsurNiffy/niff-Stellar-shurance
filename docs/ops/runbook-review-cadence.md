# Runbook Review Cadence

Runbooks can silently go stale as infrastructure changes (a documented command
no longer exists, a URL moved). This defines a periodic review process so
staleness is caught before an incident, not during one.

## Cadence

- Every runbook in `docs/ops/*runbook*.md` is reviewed **quarterly**.
- Review owner: the on-call lead for the quarter, assigned in the incident
  rotation doc.
- Reviews are tracked as a recurring calendar/issue reminder (Jan/Apr/Jul/Oct,
  first week).

## Process

1. For each runbook, dry-run every command where safely possible (non-prod
   environment, `--dry-run` flags, or read-only equivalents).
2. For commands that cannot be safely dry-run (e.g. destructive prod
   failover steps), manually verify: the binary/CLI still exists, the flags
   are still valid, and any linked URLs/dashboards still resolve.
3. If a step is stale (command removed, URL moved, owner changed), either
   fix it in the same PR or add a `> ⚠️ STALE:` callout at the top of the
   runbook describing what's wrong, and file a follow-up issue.
4. Update the "Last verified" line (see below) regardless of outcome.

## Tracking last-verified date

Add this line near the top of every runbook, just under the title:

```
> Last verified: YYYY-MM-DD by <name/handle>
```

Runbooks currently missing this line should have it added the next time
they're touched or reviewed.

## Scope

Applies to all files under `docs/ops/` with "runbook" in the name:
`disaster-recovery-runbook.md`, `maintenance-runbook.md`,
`privacy-runbook.md`, `queue-replay-runbook.md`,
`secrets-management-runbook.md`, `stellar-testnet-reset-recovery.md`.
