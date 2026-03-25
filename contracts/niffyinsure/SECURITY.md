# NiffyInsure Contract — Security Checklist

> **Status**: Pre-testnet review complete. External audit required before mainnet.
> **SDK version**: soroban-sdk 23.5.3 (MSRV Rust 1.81)
> **Last updated**: 2026-03-24
> **Owner**: protocol team

---

## Threat Matrix

Each row maps a threat to its mitigation, the code location, and the test(s) that demonstrate it.

| ID | Threat | Severity | Mitigation | Code | Tests |
|----|--------|----------|------------|------|-------|
| AUTH-01 | Non-admin caller invokes privileged entrypoint | High | `require_admin()` loads admin from storage and calls `admin.require_auth()` — parameter spoofing cannot satisfy this | `admin.rs::require_admin` | `security.rs::auth01_*` |
| AUTH-02 | Unrelated signer hijacks admin rotation via `accept_admin` | High | `accept_admin` calls `pending.require_auth()` where `pending` is read from storage, not from any parameter | `admin.rs::accept_admin` | `security.rs::auth02_*` |
| AUTH-03 | Re-initialization attack overwrites admin/token | High | `initialize` checks `DataKey::Admin` presence and panics with `AlreadyInitialized` | `lib.rs::initialize` | `security.rs::auth03_*` |
| AUTH-04 | `accept_admin` / `cancel_admin` called with no pending proposal | Medium | Both functions call `get_pending_admin` and panic with `NoPendingAdmin` if absent | `admin.rs` | `security.rs::auth04_*` |
| ARITH-01 | Counter overflow wraps silently, producing duplicate IDs | Medium | `next_policy_id` and `next_claim_id` use `checked_add`; overflow panics and reverts the transaction | `storage.rs` | _(overflow requires u32::MAX / u64::MAX iterations; property test deferred — see open items)_ |
| ARITH-02 | Premium calculation overflows i128 | Low | Max factor sum = 59; `BASE * 59 = 590_000_000` — well within i128::MAX. Documented in `premium.rs` | `premium.rs` | `types_validate.rs` (indirect) |
| TOKEN-01 | Drain called with zero or negative amount | Medium | `drain` checks `amount <= 0` before invoking token transfer | `admin.rs::drain` | `security.rs::token01_*` |
| TOKEN-02 | Non-admin drains treasury | High | `drain` calls `require_admin` before any token interaction | `admin.rs::drain` | `security.rs::token02_*` |
| TOKEN-03 | Arbitrary token address substituted in payment path | High | `token::transfer` enforces allowlist: panics with `InvalidAddress` if `token != stored_token`. `transfer_from_contract` reads the stored address directly | `token.rs` | _(integration test requires mock token contract — deferred to feat/claim-voting)_ |
| TOKEN-04 | Reentrancy via malicious token callback | Low | Soroban is single-threaded; cross-contract calls are synchronous with no callback path back into this contract. A panicking token reverts the whole transaction atomically | `token.rs` (documented) | N/A — architectural guarantee |
| PAUSE-01 | Pause state not respected by claim/vote entrypoints | High | `file_claim` and `vote_on_claim` check `storage::is_paused` at entry | `claim.rs` (feat/claim-voting) | _(voting tests — feat/claim-voting)_ |
| STORE-01 | Storage griefing via unbounded string fields | Medium | `DETAILS_MAX_LEN=256`, `IMAGE_URL_MAX_LEN=128`, `IMAGE_URLS_MAX=5` enforced in `check_claim_fields` | `validate.rs`, `types.rs` | `types_validate.rs::details_over_max_len_rejected`, `too_many_image_urls_rejected`, `image_url_over_max_len_rejected` |
| STORE-02 | Voter snapshot bloat via ineligible vote attempts | Medium | `vote_on_claim` checks snapshot membership before any storage write | `claim.rs` (feat/claim-voting) | _(voting tests — feat/claim-voting)_ |
| EVENT-01 | Silent admin mutation (no audit trail) | Medium | Every admin entrypoint emits a structured `("admin", "<action>")` event before returning | `admin.rs` | `security.rs::event01_*` |

---

## Auth Matrix

| Entrypoint | Who may call | Auth mechanism |
|------------|-------------|----------------|
| `initialize` | Anyone (once) | No auth — first caller wins; re-init blocked by `AlreadyInitialized` |
| `propose_admin` | Current admin | `require_admin()` → stored admin `require_auth()` |
| `accept_admin` | Pending admin | `pending.require_auth()` where pending is from storage |
| `cancel_admin` | Current admin | `require_admin()` |
| `set_token` | Current admin | `require_admin()` |
| `pause` | Current admin | `require_admin()` |
| `unpause` | Current admin | `require_admin()` |
| `drain` | Current admin | `require_admin()` |
| `file_claim` | Policy holder | `claimant.require_auth()` + policy key lookup by `(claimant, policy_id)` |
| `vote_on_claim` | Snapshot voter | `voter.require_auth()` + snapshot membership check |
| `finalize_claim` | Anyone | No auth — permissionless after deadline |

---

## Token Trust Model

The contract interacts with exactly **one** token contract whose address is stored at `DataKey::Token` and is admin-controlled.

- `token::transfer` enforces the allowlist: if the supplied `token` address does not match the stored address, it panics with `AdminError::InvalidAddress`.
- `token::transfer_from_contract` (used by `drain` and future claim payouts) reads the stored address directly — no caller-supplied token address enters the payment path.
- The admin who calls `set_token` is responsible for verifying the token is a well-behaved SEP-41 implementation. Production deployments **SHOULD** use a known, audited token (e.g. USDC on Stellar).
- A malicious token that panics will revert the entire transaction atomically — no partial state changes persist.

---

## Centralization Disclosure

Community policyholders govern claim outcomes via DAO voting — the admin has **no override** on individual claims. However, the following remain admin-controlled in the MVP:

| Parameter | Admin action | Risk if admin is compromised |
|-----------|-------------|------------------------------|
| Token contract address | `set_token` | Payments redirected to attacker-controlled token |
| Pause state | `pause` / `unpause` | Protocol frozen indefinitely |
| Admin key | `propose_admin` / `accept_admin` | Full admin takeover |
| Treasury funds | `drain` | All contract funds drained |

**Mitigation**: Production deployments MUST use a Stellar multisig account as admin (see `admin.rs` for setup guidance). A 3-of-5 weighted multisig is the minimum recommended configuration.

---

## Soroban-Specific Security Notes

Cross-referenced against [Soroban Security Best Practices](https://developers.stellar.org/docs/smart-contracts/security) for SDK 23.x:

1. **`require_auth` placement**: All auth checks are performed at the top of each function, before any state reads or writes. This matches the recommended pattern.
2. **No `require_auth_for_args`**: Not needed here — the auth subject is always the full function invocation, not a subset of arguments.
3. **Storage type selection**: Admin/token/pause/counters use `instance` storage (evicted together with the contract). Policy and claim records use `persistent` storage (independent TTL). This is intentional.
4. **No `unsafe` code**: The contract uses `#![no_std]` with no unsafe blocks.
5. **Integer types**: All monetary values use `i128` (Soroban's native amount type). Counters use `u32`/`u64` with `checked_add`.

---

## Open Items / Accepted Risks

| ID | Item | Severity | Owner | Target | Notes |
|----|------|----------|-------|--------|-------|
| OPEN-01 | Property-based test for counter overflow (u32::MAX iterations) | Low | protocol team | pre-mainnet | Requires a fuzzing harness; deferred |
| OPEN-02 | TOKEN-03 integration test requires a mock SEP-41 token contract | Medium | protocol team | feat/claim-voting | Will be added when claim payout is implemented |
| OPEN-03 | Timelock on `set_token` and `drain` | Medium | protocol team | post-MVP | Seam documented in `admin.rs`; not implemented |
| OPEN-04 | Community-vote-triggered unpause path | Low | protocol team | post-MVP | Seam documented in `admin.rs` |
| OPEN-05 | Third-party security audit | High | protocol team | pre-mainnet | Budget approval pending. Recommended firms: OtterSec, Halborn, Trail of Bits |
| OPEN-06 | Formal verification of tally reconciliation invariant | Low | protocol team | post-audit | `approve_votes + reject_votes == count(Vote(claim_id, *))` |

---

## Test Coverage Map

| Test file | Threats covered |
|-----------|----------------|
| `tests/security.rs` | AUTH-01, AUTH-02, AUTH-03, AUTH-04, TOKEN-01, TOKEN-02, EVENT-01 |
| `tests/types_validate.rs` | ARITH-02, STORE-01 |
| `tests/integration.rs` | AUTH-03 (initialize) |
| `tests/admin.rs` | AUTH-01 through AUTH-04, TOKEN-01, TOKEN-02, EVENT-01 (full matrix) |
| `tests/voting.rs` _(feat/claim-voting)_ | PAUSE-01, STORE-02, AUTH-01 (voter spoofing) |

---

## Audit Preparation Checklist

- [x] Auth matrix documented and tested
- [x] Checked arithmetic on all counters
- [x] Token allowlist enforced in payment path
- [x] Reentrancy analysis documented
- [x] Centralization risks disclosed
- [x] All admin mutations emit structured events
- [x] `SECURITY.md` links tests to threats
- [ ] Third-party audit scheduled (OPEN-05)
- [ ] Property tests for overflow (OPEN-01)
- [ ] Mock token integration tests (OPEN-02)
- [ ] Timelock implementation (OPEN-03)
