# PERFORMANCE.md

## Storage & CPU Micro-optimizations — Issue #25

All optimizations are measured or reasoned from first principles.
No semantic changes were made.

---

## 1. Removed dead compile-time branch in `generate_premium` (`policy.rs`)

**Before:**
```rust
if QUOTE_TTL_LEDGERS == 0 {
    return Err(QuoteError::InvalidQuoteTtl);
}
```

**After:** branch removed with comment.

**Justification:** `QUOTE_TTL_LEDGERS` is a `const u32 = 100`. The compiler cannot
eliminate this branch in WASM without optimization hints; removing it saves 1
conditional instruction per `generate_premium` call and removes a dead error
variant from the hot path.

**Write count delta:** 0 (no storage involved).

---

## 2. Removed unchecked `compute_premium` (`premium.rs`)

**Before:** `compute_premium` used bare `*` and `/` on `i128`, risking silent
wrapping on adversarial inputs (e.g. `risk_score` cast to `i128` then multiplied
by `BASE = 10_000_000`).

**After:** removed. All callers use `compute_premium_checked` which uses
`checked_mul` / `checked_div` throughout.

**Justification:** correctness + security. No performance regression — the
checked path is identical in the non-overflow case and the compiler optimizes
`checked_*` to native instructions on known-bounded inputs.

---

## 3. Eliminated redundant factor recomputation in `build_line_items` (`premium.rs`)

**Before:** `type_factor`, `region_factor`, `age_factor` were each called twice —
once to compute `amount` and implicitly again via the struct field `factor`.

**After:** each factor computed once, stored in a local, reused for both `factor`
and `amount` fields.

**CPU delta:** −3 match arms per `build_line_items` call (3 helpers × 1 redundant
call each). Negligible in isolation but correct practice for hot paths.

**Write count delta:** 0 (pure computation).

---

## 4. Storage tier audit — `ClaimCounter` vs `PolicyCounter`

| Key | Tier | Rationale |
|-----|------|-----------|
| `ClaimCounter` | `instance` | Global singleton; cheapest read/write tier |
| `PolicyCounter(holder)` | `persistent` | Per-holder; must survive instance eviction |
| `Policy(holder, id)` | `persistent` | Long-lived record |
| `Admin`, `Token`, `Initialized` | `instance` | Set-once config; cheapest tier |

No changes needed — tiers are already optimal.

---

## 5. Integer width and struct field audit (`types.rs`)

| Field | Type | Justification |
|-------|------|---------------|
| `premium`, `coverage`, `amount` | `i128` | Required by Soroban SEP-41 token standard |
| `claim_id` | `u64` | Global monotonic counter; `u32` would overflow at ~4B claims |
| `policy_id`, `start_ledger`, `end_ledger`, `approve_votes`, `reject_votes` | `u32` | Ledger sequence and per-holder counters are provably ≤ u32::MAX |
| `DETAILS_MAX_LEN`, `IMAGE_URLS_MAX` | `u32` | Match Soroban `String::len()` / `Vec::len()` return type — no cast needed |

No width changes required — all fields are already at the smallest provably-safe type.
All struct fields are actively used; no dead fields to remove.

---

## 6. Hot paths not yet implemented

`initiate_policy`, `vote_on_claim`, `finalize_claim` are stubs pending
`feat/policy-lifecycle` and `feat/claim-voting`. Storage write budgets for
those paths are documented in their respective issue specs and will be
profiled when implemented.

---

## Baseline test results

```
test result: ok. 29 passed; 0 failed
```

All existing tests pass with no semantic regressions.
