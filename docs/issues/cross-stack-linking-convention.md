# Cross-Stack Issue Linking Convention

## Problem

A single feature (e.g. a new claim status) often requires coordinated
contract, backend, and frontend issues. Without a convention for linking
them, it's easy to lose track of a partially-completed cross-stack feature.

## Convention

1. **Shared label** — every issue belonging to the same cross-stack feature
   gets the same `feature:<short-name>` label (e.g. `feature:claim-escalation`).
2. **Related issues section** — every issue in the group includes a
   `## Related issues` section listing the other issue(s) by number/title,
   and which layer each belongs to (Contract / Backend / Frontend).
3. **Umbrella tracking issue** — for features spanning 3+ issues, create one
   umbrella issue titled `Tracking: <feature name>` with a checklist linking
   to each layer's issue. Individual issues link back to the umbrella issue
   in their `Related issues` section.

## Example

```
## Related issues
- Tracking: #900 (umbrella)
- Contract: #901 — add `Escalated` claim status variant
- Backend: #902 — expose escalation entrypoint via GraphQL mutation
- Frontend: #903 — this issue
```

## Demonstration (applied retroactively)

See `## Related issues` sections added to
[issue-916-voter-snapshot-viewer.md](./issue-916-voter-snapshot-viewer.md) and
[issue-917-fraud-score-badge.md](./issue-917-fraud-score-badge.md) as a sample
application of this convention to existing, related issues.
