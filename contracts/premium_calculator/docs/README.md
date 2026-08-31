# Premium Calculator documentation

Contract crate: `contracts/premium_calculator`.

| Doc | Description |
|-----|-------------|
| [ERROR_CATALOG.md](./ERROR_CATALOG.md) | Cause + caller remediation for every `CalcError` variant |
| [CALCULATOR-INTERFACE.md](../../niffyinsure/docs/CALCULATOR-INTERFACE.md) | Cross-contract ABI used by `niffyinsure` |

## Entrypoints (summary)

| Entrypoint | Purpose |
|------------|---------|
| `initialize` | One-time admin + default multiplier table |
| `compute` | Price a `CalcInput` → `CalcResult` |
| `get_version` | Multiplier / capability version (`u32`) |
| `version` | Build-time semver from `Cargo.toml` |
| `abi_version` | Stable ABI pin for integrators (`u32`) |
| `update_table` | Admin: replace multipliers (strictly increasing version) |
| `set_paused` | Admin: pause/unpause `compute` |
