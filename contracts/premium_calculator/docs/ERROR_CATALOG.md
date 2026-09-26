# Premium Calculator — Error Catalog

Human-readable reference for every `CalcError` variant defined in
`contracts/premium_calculator/src/errors.rs`. Use this when integrating
cross-contract callers (e.g. `niffyinsure`) or debugging failed invocations.

**Related docs:** [README](./README.md) · [niffyinsure calculator interface](../../niffyinsure/docs/CALCULATOR-INTERFACE.md)

---

## Quick index

| Code | Variant | Entrypoints that can return it |
|------|---------|--------------------------------|
| 1 | `NotInitialized` | `compute`, `update_table`, `set_paused` |
| 2 | `AlreadyInitialized` | `initialize` |
| 3 | `Unauthorized` | *(reserved — not returned today; see note)* |
| 4 | `InvalidBaseAmount` | `compute` |
| 5 | `SafetyScoreOutOfRange` | `compute` |
| 6 | `MissingRegionMultiplier` | `compute`, `update_table` |
| 7 | `MissingAgeMultiplier` | `compute`, `update_table` |
| 8 | `MissingCoverageMultiplier` | `compute`, `update_table` |
| 9 | `RegionMultiplierOutOfBounds` | `update_table` |
| 10 | `AgeMultiplierOutOfBounds` | `update_table` |
| 11 | `CoverageMultiplierOutOfBounds` | `update_table` |
| 12 | `SafetyDiscountOutOfBounds` | `update_table` |
| 13 | `InvalidConfigVersion` | `update_table` |
| 14 | `Overflow` | `compute` |
| 15 | `DivideByZero` | `compute` *(defensive; tables reject `den == 0`)* |
| 16 | `NegativePremiumNotSupported` | `compute` |
| 17 | `Paused` | `compute` |

Read-only entrypoints `get_version` and `version` never return `CalcError`.

---

## Variants

### `NotInitialized` (1)

**Cause:** Contract has no admin / multiplier table yet (`initialize` was never
called), and a state-mutating or pricing entrypoint needs that state.

**Caller handling:** Deploy and call `initialize(admin)` before `compute`,
`update_table`, or `set_paused`. Do not treat as a transient pricing failure.

---

### `AlreadyInitialized` (2)

**Cause:** `initialize` was called when an admin is already stored.

**Caller handling:** Do not retry init. Use the existing deployment or deploy a
new contract instance. Admin rotation is out of scope for this error.

---

### `Unauthorized` (3)

**Cause:** Reserved for authorization failures on admin entrypoints.

**Current behaviour:** `update_table` / `set_paused` call
`admin.require_auth()`, which aborts the host invocation on missing auth
rather than returning this typed code. The variant is kept for ABI stability
and future Result-based auth checks.

**Caller handling:** Ensure the stored admin signs the transaction. If you see
a host auth abort (not code 3), fix the signing account — do not remap to a
pricing fallback.

---

### `InvalidBaseAmount` (4)

**Cause:** `CalcInput.base_amount <= 0`.

**Caller handling:** Pass a positive coverage / base amount in stroops. Reject
the quote client-side before invoking when amount is zero or negative.

---

### `SafetyScoreOutOfRange` (5)

**Cause:** `CalcInput.safety_score > 100`.

**Caller handling:** Clamp or validate safety score to `0..=100` before the
cross-contract call.

---

### `MissingRegionMultiplier` (6)

**Cause:**
- **`compute`:** Input `region` key is absent from the stored table map; or
- **`update_table`:** New table `region` map does not contain exactly 3 entries.

**Caller handling:** For pricing, use only supported `RegionTier` values and
ensure the calculator table is fully seeded. For admin updates, provide Low /
Medium / High entries.

---

### `MissingAgeMultiplier` (7)

**Cause:** Same pattern as region, for `age_band` / age map (must have 3 bands
on `update_table`).

**Caller handling:** Use `Young` / `Adult` / `Senior` only; admin must supply
all three multipliers.

---

### `MissingCoverageMultiplier` (8)

**Cause:** Same pattern for `coverage` / coverage map (must have 3 tiers on
`update_table`).

**Caller handling:** Use `Basic` / `Standard` / `Premium` only; admin must
supply all three multipliers.

---

### `RegionMultiplierOutOfBounds` (9)

**Cause:** On `update_table`, a region multiplier is outside
`[MIN_MULTIPLIER, MAX_MULTIPLIER]` (`5_000..=50_000`, scale 10_000 = 1.0x).

**Caller handling:** Correct the table values and resubmit with a higher
`version`.

---

### `AgeMultiplierOutOfBounds` (10)

**Cause:** An age-band multiplier is outside the allowed bounds on
`update_table`.

**Caller handling:** Same as region — fix values, bump `version`, retry.

---

### `CoverageMultiplierOutOfBounds` (11)

**Cause:** A coverage-tier multiplier is outside the allowed bounds on
`update_table`.

**Caller handling:** Same as region — fix values, bump `version`, retry.

---

### `SafetyDiscountOutOfBounds` (12)

**Cause:** `safety_discount < 0` or `> MAX_SAFETY_DISCOUNT` (`5_000`) on
`update_table`.

**Caller handling:** Keep discount in `0..=5_000` (scale 10_000).

---

### `InvalidConfigVersion` (13)

**Cause:** `update_table` submitted a `new_table.version` that is not **strictly
greater** than the currently stored table version.

**Caller handling:** Read the current table / `get_version()`, then submit a
monotonically increasing version. Do not reuse or decrease versions.

---

### `Overflow` (14)

**Cause:** Intermediate `checked_mul` / `checked_sub` in premium math overflowed
`i128` (extreme `base_amount` × multiplier products).

**Caller handling:** Reject oversized inputs; treat as a hard failure (no
fallback that silently truncates). Reduce `base_amount` or multipliers.

---

### `DivideByZero` (15)

**Cause:** Defensive guard in `mul_ratio` when `den == 0`. Production tables use
`SCALE = 10_000` as the denominator, so this should not appear under valid
config.

**Caller handling:** Treat as a calculator integrity failure; pause usage and
inspect the deployed WASM / table. Do not retry blindly.

---

### `NegativePremiumNotSupported` (16)

**Cause:** `mul_ratio` received a negative `amount`, `num`, or `den` (corrupt or
hostile table / input).

**Caller handling:** Fail closed. Admin must fix the multiplier table; callers
must not pass negative base amounts (also covered by `InvalidBaseAmount`).

---

### `Paused` (17)

**Cause:** `compute` was called while the calculator pause flag is set
(`set_paused(true)`).

**Caller handling:** **Special for `niffyinsure`:** mapped to
`Error::CalculatorPaused` (bind fail-closed). Do not fall back to local pricing
on this code during a configured cross-contract path. Wait for admin unpause or
clear the calculator address via ops runbook.

---

## Cross-check notes

- Every variant in `errors.rs` is listed above.
- Variants **actually returned** as `Err(CalcError::…)` from entrypoints today:
  all except `Unauthorized` (auth uses host `require_auth` abort) and
  practically `DivideByZero` (only if math is called with `den == 0`).
- Policy-contract mapping of calculator invoke results is documented in
  [`CALCULATOR-INTERFACE.md`](../../niffyinsure/docs/CALCULATOR-INTERFACE.md).
