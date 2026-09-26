# Premium Calculator Cross-Contract Interface

## Overview

The `niffyinsure` policy contract integrates with an external `premium_calculator` contract via cross-contract invocation for premium computation. This document specifies the interface contract between the two systems.

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│  NiffyInsure        │         │  PremiumCalculator   │
│  (Policy Contract)  │────────▶│  (Pricing Engine)    │
│                     │ compute │                      │
└─────────────────────┘         └──────────────────────┘
```

### Routing Logic

The policy contract uses **conditional routing** for premium computation:

- **Calculator configured** (`CalcAddress` set): Cross-contract call to external calculator
- **Calculator not configured** (`CalcAddress` absent): Local fallback engine

This design ensures:
- Zero-downtime migration (existing deployments continue working)
- Graceful degradation (local fallback if calculator unavailable)
- Flexible pricing (admin can hot-swap calculator implementations)

## Interface Specification

### Version

**Interface Version:** `1.0.0`  
**Soroban SDK:** `25.3.1`  
**Contract ABI:** Soroban `contractclient` binding

### Required Entrypoint

The calculator contract MUST implement:

```rust
pub fn compute(env: Env, input: CalcInput) -> Result<CalcResult, CalcError>
```

#### Input Type: `CalcInput`

```rust
#[contracttype]
pub struct CalcInput {
    pub region: RegionTier,      // Geographic risk tier
    pub age_band: AgeBand,        // Underwriting age bucket
    pub coverage: CoverageTier,   // Coverage level
    pub safety_score: u32,        // 0..=100; percentage of max safety discount
    pub base_amount: i128,        // Coverage amount in stroops
}
```

**Enum Definitions:**

```rust
#[contracttype]
pub enum RegionTier {
    Low,
    Medium,
    High,
}

#[contracttype]
pub enum AgeBand {
    Young,
    Adult,
    Senior,
}

#[contracttype]
pub enum CoverageTier {
    Basic,
    Standard,
    Premium,
}
```

#### Output Type: `CalcResult`

```rust
#[contracttype]
pub struct CalcResult {
    pub premium: i128,           // Computed premium in stroops
    pub config_version: u32,     // Multiplier table version (capability flag)
}
```

#### Error Type: `CalcError`

```rust
#[contracterror]
pub enum CalcError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidBaseAmount = 4,
    SafetyScoreOutOfRange = 5,
    MissingRegionMultiplier = 6,
    MissingAgeMultiplier = 7,
    MissingCoverageMultiplier = 8,
    RegionMultiplierOutOfBounds = 9,
    AgeMultiplierOutOfBounds = 10,
    CoverageMultiplierOutOfBounds = 11,
    SafetyDiscountOutOfBounds = 12,
    InvalidConfigVersion = 13,
    Overflow = 14,
    DivideByZero = 15,
    NegativePremiumNotSupported = 16,
    Paused = 17,  // ⚠️ Special: triggers CalculatorPaused in policy contract
}
```

**Critical Error Code:**
- `Paused = 17`: Policy contract distinguishes this error and returns `Error::CalculatorPaused` instead of generic `CalculatorCallFailed`

### Optional Entrypoints

```rust
pub fn get_version(env: Env) -> u32
```
Returns the current multiplier table version (capability flag for pricing config).

```rust
pub fn abi_version(env: Env) -> u32
```
Returns the stable ABI pin (`premium_calculator::ABI_VERSION`). Integrators should
pin against this value — it changes only when `CalcInput` / `CalcResult` / entrypoint
shape breaks compatibility. Independent of multiplier-table `get_version()`.

```rust
pub fn version(env: Env) -> String
```
Returns the semver version string from `Cargo.toml` (build-time metadata).

## Error Handling

### Policy Contract Error Mapping

The policy contract (`calculator.rs`) maps calculator errors as follows:

| Calculator State | Policy Contract Error | Description |
|-----------------|----------------------|-------------|
| `Ok(Ok(CalcResult))` | Success | Normal path |
| `Ok(Err(_))` | `CalculatorCallFailed` | Type conversion failure |
| `Err(Ok(CalcError::Paused))` | `CalculatorPaused` | Calculator explicitly paused |
| `Err(Ok(CalcError::*))` | `CalculatorCallFailed` | Other typed calculator errors |
| `Err(Err(InvokeError))` | `CalculatorCallFailed` | Host-level abort/panic/undeployed |

### Fail-Closed Semantics

The integration follows **fail-closed** semantics:
- Calculator errors propagate to the caller (no silent fallback during cross-contract call)
- Undeployed calculator → `CalculatorCallFailed` (host-level `InvokeError`)
- Paused calculator → `CalculatorPaused` (explicit error code 17)

### Fallback Behavior

**Local engine fallback** only applies when:
- `CalcAddress` is **not set** (no calculator configured)
- NOT when calculator call fails (fail-closed)

This prevents silent degradation masking operational issues.

## Type Compatibility

### Structural Identity Requirement

The policy contract mirrors calculator types in `calculator.rs`:

```rust
// ── Mirrored types from premium_calculator ────────────────────────────────────
// These must stay structurally identical to `premium_calculator::types`.

#[contracttype]
pub enum CalcRegionTier { Low, Medium, High }

#[contracttype]
pub enum CalcAgeBand { Young, Adult, Senior }

#[contracttype]
pub enum CalcCoverageType { Basic, Standard, Premium }
```

**Breaking Change Risk:**
- Adding/removing enum variants breaks ABI compatibility
- Reordering variants breaks serialization
- Renaming fields breaks deserialization

**Mitigation:**
- Version negotiation via `get_version()` entrypoint
- Integration tests verify type compatibility (`cross_contract.rs`)

## Configuration

### Admin Operations

```rust
// Set calculator address (admin-only)
pub fn set_calculator(env: Env, calculator: Address)

// Set calculator address + expected ABI version atomically (0 disables the pin)
pub fn set_calculator_with_version(env: Env, calculator: Address, expected_version: u32)

// Clear calculator address (revert to local engine) and clear expected ABI pin
pub fn clear_calculator(env: Env)

// Read current calculator address
pub fn get_calculator(env: Env) -> Option<Address>

// Expected ABI pin (None = check disabled)
pub fn get_expected_calc_version(env: Env) -> Option<u32>

// ABI version from the last successful external compute (None if never succeeded)
pub fn get_last_calc_abi_version(env: Env) -> Option<u32>
```

### Storage Key

```rust
DataKey::CalcAddress  // Instance storage, admin-controlled
// Plus instance symbols: "calc_exp_ver", "calc_last_abi"
```

### ABI mismatch detection

1. **Automatic:** When `get_expected_calc_version()` is `Some(v)`, every external
   `compute` asserts `calculator.abi_version() == v` first. Mismatch →
   `Error::CalculatorVersionMismatch` (no silent success).
2. **Manual (post-upgrade):** Compare
   `niffyinsure.get_last_calc_abi_version()` with `calculator.abi_version()`.
   If they differ after an upgrade, update the pin via
   `set_calculator_with_version` (or clear and re-bind).

Normal operation with a matching pin is unchanged: successful computes still
return quotes and refresh `get_last_calc_abi_version()`.

## Integration Points

### Policy Binding Path

Cross-contract calls occur during:

1. **`initiate_policy`**: New policy creation
2. **`renew_policy`**: Policy renewal (term extension)

Both call `calculator::compute_quote()` which routes to external calculator when configured.

### Read-Only Quote Path

**`generate_premium`** (read-only quote simulation) uses the **local engine** directly:
- No cross-contract call
- No persistent writes
- Deterministic pricing from on-chain multiplier table

This ensures quote availability even if calculator is paused/unavailable.

## Testing

### Integration Test Coverage

See `contracts/niffyinsure/tests/cross_contract.rs`:

| Test | Coverage |
|------|----------|
| `generate_premium_uses_local_engine_when_no_calculator_set` | Fallback when no calculator configured |
| `generate_premium_routes_to_external_calculator` | Cross-contract call success path |
| `calculator_rotation_changes_pricing` | Hot-swap calculator addresses |
| `paused_calculator_causes_bind_fail_closed` | Paused calculator error handling |
| `clear_calculator_reverts_to_local_engine` | Clearing calculator address |
| `set_calculator_requires_admin_auth` | Admin authorization |
| `undeployed_calculator_falls_back_to_local_engine` | Undeployed contract handling |
| `initiate_policy_uses_cross_contract_calculator` | Policy binding with calculator |
| `initiate_policy_fallback_when_calculator_not_deployed` | Policy binding fallback |

## Versioning

### Interface Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-04 | Initial interface specification |

### Compatibility Matrix

| Policy Contract | Calculator Contract | Compatible |
|----------------|---------------------|------------|
| 0.1.0 | 0.1.0 | ✅ |

### Breaking Changes

Future breaking changes require:
1. Bump interface version
2. Update compatibility matrix
3. Migration guide for existing deployments
4. Deprecation notice (minimum 1 release cycle)

## Security Considerations

### Trust Model

- **Calculator contract is TRUSTED**: Policy contract does not validate calculator output
- **Admin controls calculator address**: Malicious admin can point to malicious calculator
- **No signature verification**: Calculator output is not cryptographically signed

### Attack Vectors

| Attack | Mitigation |
|--------|-----------|
| Malicious calculator returns inflated premiums | Admin key security + governance |
| Calculator returns zero premium | Policy contract validates `premium > 0` |
| Calculator panics/aborts | Fail-closed: transaction reverts |
| Calculator address points to non-contract | Host-level error → `CalculatorCallFailed` |

### Recommendations

1. **Calculator deployment**: Use deterministic WASM builds + reproducible verification
2. **Admin key**: Multi-sig or governance-controlled
3. **Monitoring**: Alert on `CalculatorCallFailed` / `CalculatorPaused` errors
4. **Auditing**: Independent security review before mainnet deployment

## Operational Runbook

### Calculator Upgrade Procedure

1. Deploy new calculator contract
2. Verify `abi_version()` matches the pin you intend to use (testnet)
3. Verify `compute()` returns expected values (testnet)
4. Admin calls `set_calculator_with_version(new_address, expected_abi)`
5. Confirm `get_last_calc_abi_version()` updates after a successful bind/quote path
6. Monitor error rates for 24h (watch for `CalculatorVersionMismatch`)
7. If issues: `clear_calculator()` to revert to local engine

### Emergency Response

**Calculator unavailable:**
```bash
# Revert to local engine
stellar contract invoke \
  --id <policy-contract> \
  --source-account <admin> \
  -- clear_calculator
```

**Calculator paused:**
```bash
# Unpause calculator
stellar contract invoke \
  --id <calculator-contract> \
  --source-account <calc-admin> \
  -- set_paused --paused false
```

## References

- Policy contract: `contracts/niffyinsure/src/calculator.rs`
- Calculator contract: `contracts/premium_calculator/src/lib.rs`
- Calculator error catalog: `contracts/premium_calculator/docs/ERROR_CATALOG.md`
- Integration tests: `contracts/niffyinsure/tests/cross_contract.rs`, `calc_abi_version.rs`
- Soroban SDK: https://docs.rs/soroban-sdk/25.3.1
