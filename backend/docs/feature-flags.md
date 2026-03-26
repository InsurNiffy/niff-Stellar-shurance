# Backend Feature Flags Runbook

## Purpose
Feature flags gate experimental backend routes at the API edge so unfinished modules are fully unreachable when disabled.

Safe default: any missing flag is treated as `false`.

## Configuration
Set `FEATURE_FLAGS_JSON` as a JSON object at process start:

```bash
FEATURE_FLAGS_JSON='{"experimental.oracleHooks":false,"experimental.betaCalculators":false}'
```

Optional response strategy for disabled routes:

- `FEATURE_FLAGS_DISABLED_STATUS=404` (default, hides route existence)
- `FEATURE_FLAGS_DISABLED_STATUS=403` (explicitly forbidden)

## Current Flags
| Flag name | Default | Owner | Meaning |
|---|---|---|---|
| `experimental.oracleHooks` | `false` | Backend Platform Team | Enables `/experimental/oracle-hooks/*` ingestion hooks for oracle event experiments. |
| `experimental.betaCalculators` | `false` | Underwriting Engine Team | Enables `/experimental/beta-calculators/*` premium preview APIs under validation. |

## Lifecycle
1. Creation: add a single-purpose flag and owner in this document before merging code.
2. Enablement: turn on only in non-production first, monitor error rate and access logs.
3. Promotion: after stable metrics and review, enable for production rollout with change ticket.
4. Removal: once fully adopted, delete guard/decorator usage and remove the flag from env + docs.

## Operational Guardrails
- Feature flags do not replace authentication or authorization controls.
- Keep total flag count low to avoid long-lived configuration sprawl.
- Disabled-access attempts are logged (`FeatureFlagsGuard`) for metrics pipelines.
