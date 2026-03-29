# Policy deductible

## Product rule (coverage cap)

- **Coverage cap** applies at **claim filing**: `claim.amount` must be `> 0` and `≤ policy.coverage` (`check_claim_fields`).
- **Deductible** is stored on the policy at **bind** (`initiate_policy`), in the **same asset units** as premium and payout.
- **Deductible does not shrink the filing cap**: the claimant can still file up to the full coverage amount.
- **Payout** uses **gross = `claim.amount`** (approved amount) and **net = gross − deductible_snapshot**, where `deductible_snapshot` is copied from the policy at `file_claim` into `Claim.deductible`.

## Validation

- At bind: `deductible` must be `None`, `Some(0)` (stored as `None`), or `Some(d)` with `0 < d ≤ coverage` (`PolicyError::InvalidDeductible` otherwise).
- `check_policy` also enforces `deductible ≤ coverage` (returns `validate::Error::Overflow` if violated — the `contracterror` enum is at Soroban’s max variant count).
- At payout: if `net ≤ 0`, `process_claim` returns **`validate::Error::ClaimAmountZero`** (again, no spare error discriminant). There is **no** token transfer in that case.

## Events (indexer / UI)

- **`PolicyInitiated`**: includes `deductible: Option<i128>`.
- **`ClaimFiled`** (`niffyinsure` / `claim_filed`): `policy_id`, `claim_amount`, `deductible`, `image_hash`, plus `claim_id` topic.
- **`ClaimProcessed`** (`niffyinsure` / `claim_paid`): `gross_amount`, `deductible`, `amount` (**net** transferred).

## Renewal

- `renew_policy` updates `policy.coverage` to the new `base_amount` and re-runs `check_policy`. If the **existing** deductible exceeds the new coverage, renewal fails with `RenewalError::InvalidDeductible`.

## Tests

```bash
cargo test -p niffyinsure deductible
cargo test -p niffyinsure types_validate::deductible
```
