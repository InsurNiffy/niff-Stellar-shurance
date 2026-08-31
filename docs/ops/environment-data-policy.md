# Environment Data Policy

## Overview

Defines which environments may use anonymized-production data versus
synthetic-only data, and the anonymization bar that must be met before any
production-derived data is used outside production.

## Data Source by Environment

| Environment | Allowed data source |
|---|---|
| Production | Live production data only |
| Staging | Anonymized-production data **or** synthetic data |
| Test (CI) | Synthetic data only — no production-derived data |
| Local development | Synthetic data only — no production-derived data |

Production data, even anonymized, must never be copied to a local developer
machine or a CI runner. Staging is the only non-production environment where
anonymized-production data is permitted, because it is access-controlled
similarly to production and is the environment used to validate behavior at
production-like scale/shape.

## Anonymization Requirements

Before any production-derived record may be used in staging, it must:

1. Have all directly identifying fields (name, email, wallet address, phone,
   physical address, government ID) replaced with generated/synthetic
   equivalents — not masked or truncated, fully replaced.
2. Have free-text fields (claim descriptions, support notes, etc.) either
   replaced with synthetic text or run through a redaction pass that strips
   any embedded PII.
3. Have monetary amounts and dates jittered so exact production values cannot
   be reconstructed or correlated back to a real user.
4. Preserve referential integrity (foreign keys, claim/policy relationships)
   so the anonymized dataset is still structurally realistic.
5. Be regenerated from a fresh production export rather than incrementally
   patched, so stale anonymization gaps don't accumulate over time.

Any dataset that cannot meet all five requirements must fall back to fully
synthetic data instead.

## Related Policies

This policy is cross-referenced from the staging data refresh job's
documentation — see
[staging-data-refresh-job.md](./staging-data-refresh-job.md).
