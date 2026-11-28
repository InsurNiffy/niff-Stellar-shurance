# Contracts

This directory contains the Soroban smart contracts for the Handsoff protocol.

## Crates

- `insurance` — core insurance policy, claims, and governance logic.
- `governance_token` — governance token stub.

## Oracle integration (experimental)

The `insurance` crate ships an `oracle` module that provides scaffolding for
future parametric-trigger integration. It is compiled **only** when the
`experimental` feature is enabled:

```sh
cargo build -p insurance --features experimental
```

### Stub entrypoints

- `query_trigger` — query the state of a parametric trigger.
- `validate_trigger` — validate a trigger definition before execution.
- `execute_trigger` — execute a validated parametric trigger.

In **default builds** (without `--features experimental`) the module is not
compiled, and any attempt to reach oracle functionality panics with
`ORACLE_TRIGGERS_DISABLED`. This guarantees that default builds cannot
accidentally execute oracle triggers.

### Activation prerequisites

Before the oracle integration can be enabled in production, the following
must be completed:

1. **Security review** — independent audit of the oracle module, its
   entrypoints, and their interaction with the insurance contract state.
2. **Legal review** — confirmation that parametric-trigger execution complies
   with applicable regulatory and contractual requirements.
3. **Cryptographic design** — a reviewed design for oracle authentication,
   data integrity, and replay protection (including key management and
   signature verification).

Until all three prerequisites are satisfied, the module must remain behind the
`experimental` feature flag and must not be enabled in production builds.
