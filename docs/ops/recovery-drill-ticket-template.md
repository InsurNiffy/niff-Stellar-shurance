# Recovery Drill Ticket Template

Use this template in your internal wiki, incident tool, or ticketing system for every quarterly restore drill and every real recovery event.

## Metadata

- Environment:
- Date:
- Incident commander:
- Backend responder:
- DBA/Ops responder:
- Backup object key:
- Restore database target:
- Replay anchor ledger `N`:

## Timing

- Restore started at:
- Restore completed at:
- Replay started at:
- Replay completed at:
- Observed RPO:
- Observed RTO:

## Validation

- `policies` row count:
- `claims` row count:
- `raw_events` row count:
- Restored `ledger_cursors` values:
- Replay reached current ledger window: yes/no
- Smoke test status:

## Findings

- What worked:
- What was slow or manual:
- Any access, IAM, or secret issues:
- Any replay/data-consistency issues:

## Follow-up actions

- Owner:
- Due date:
- Linked PRs/issues:
