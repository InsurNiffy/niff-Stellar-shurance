# Oracle Stub — Integration Notes

The `oracle.rs` module provides scaffolding for future parametric-trigger
integration. It is only compiled under `--features experimental` and has
no effect on default production builds.

## No-data behaviour

When the oracle stub has no data available for a requested query, all
entrypoints return a clear, documented error rather than a silent default:

| Entrypoint | No-data return value |
|---|---|
| `query_trigger(trigger_id)` | `Err(OracleError::TriggerNotFound)` |
| `validate_trigger(trigger_id, ..)` | `Err(OracleError::TriggerNotFound)` |
| `execute_trigger(trigger_id, ..)` | `Err(OracleError::TriggerNotFound)` |
| `get_trigger(trigger_id)` | `None` (low-level helper; prefer `query_trigger`) |
| `get_trigger_status(trigger_id)` | `None` |

Callers **must not** interpret `TriggerNotFound` as an implicit approval or
treat it as a transient network error. It means no trigger record exists
for that ID.

## Oracle disabled (default builds)

When the `experimental` feature is off:

- `storage::is_oracle_enabled` panics with `"ORACLE_TRIGGERS_DISABLED"`.
- All oracle storage functions panic similarly.
- `validate::check_oracle_trigger` panics with `"ORACLE_VALIDATION_DISABLED"`.

This makes it impossible to accidentally process oracle triggers in a default
production WASM.

## Activation prerequisites

Before enabling the oracle in production, the following must be completed
(see `contracts/niffyinsure/src/oracle.rs` for details):

1. Cryptographic design review (signature scheme, replay protection).
2. Game-theoretic analysis (oracle incentivization, sybil resistance).
3. Legal/compliance review (parametric vs. indemnity classification).
4. Security audit by qualified Soroban smart contract auditors.
