# Claim voter snapshot TTL and `refresh_snapshot`

## Why this exists

Eligible voters for a claim are stored in persistent Soroban storage (`ClaimVoters(claim_id)`),
captured at `file_claim`. Persistent entries have a **ledger TTL**; when TTL is exhausted the
entry is **archived/evicted** and reads behave as if the key is absent.

Without an explicit check, a missing snapshot could be treated like an empty electorate and block
legitimate voters with `NotEligibleVoter`. The contract now:

- Uses **dedicated TTL constants** for snapshot keys (aligned with the maximum configured voting
  window plus margin).
- Exposes a **permissionless** `refresh_snapshot(claim_id)` that only calls `extend_ttl` on the
  existing snapshot (no rewrite of voters or votes).
- Reverts `vote_on_claim` with **`VoterSnapshotExpired` (contract error code 51)** when the voting
  window is still open but the snapshot entry is missing.

## Constants (`storage.rs`)

| Constant | Value | Purpose |
|---|---|---|
| `CLAIM_VOTER_SNAPSHOT_TTL_THRESHOLD` | `MAX_VOTING_DURATION_LEDGERS + LEDGERS_PER_WEEK` | Minimum remaining TTL before `extend_ttl` engages |
| `CLAIM_VOTER_SNAPSHOT_EXTEND_TO` | `MAX_VOTING_DURATION_LEDGERS + 3 * LEDGERS_PER_WEEK` | Target remaining TTL after extension |

Both constants track `MAX_VOTING_DURATION_LEDGERS` from `ledger.rs` so they automatically stay
correct if the admin-configurable voting duration bound changes.

## Stellar / Soroban guidance

TTL and rent-style archival are network- and protocol-defined. Operators should follow current
Stellar documentation for **persistent storage TTL** and **state archival** when planning keeper
cadence and fee budgets:

https://developers.stellar.org/docs/learn/smart-contract-internals/state-archival

## Recommended refresh cadence

**Goal:** the `ClaimVoters` entry must remain live through `voting_deadline_ledger`.

1. Index `ClaimFiled` events to track every open claim and its `voting_deadline_ledger`.
2. For each open claim, estimate remaining snapshot TTL via RPC (`getLedgerEntries` with
   `xdr.LedgerKey` for the `ClaimVoters` key).
3. Call `refresh_snapshot(claim_id)` when remaining TTL drops below
   `(voting_deadline_ledger - current_ledger) + LEDGERS_PER_WEEK` (one week safety margin).
4. A simple conservative schedule: **refresh every nominal week** for any claim still in
   `Processing` with an open voting window.

Exact ledger numbers depend on the network and current Soroban TTL rules; monitors should use
RPC or indexers that expose **remaining TTL** for contract keys where available.

## Error semantics

| Scenario | Error returned |
|---|---|
| `vote_on_claim` while snapshot is missing | `VoterSnapshotExpired` (code 51) |
| `refresh_snapshot` when claim does not exist | `ClaimNotFound` (code 28) |
| `refresh_snapshot` when snapshot already evicted | `VoterSnapshotExpired` (code 51) |

`VoterSnapshotExpired` is **actionable**: it tells the caller exactly what went wrong and that
`refresh_snapshot` should have been called earlier. It is distinct from `NotEligibleVoter` (code
41), which means the voter was never in the electorate.

## Operational runbook

### Who monitors

- **Operational owner:** the protocol / DAO ops team (or an automated keeper service they run).
- **Permissionless:** any account may call `refresh_snapshot`; no admin auth is required. Third
  parties (e.g., claimants, voters) may also call it to self-serve if the ops team is slow.

### Keeper setup (recommended)

```
1. Subscribe to ClaimFiled events (Horizon or Soroban RPC event stream).
2. For each new claim_id, record (claim_id, voting_deadline_ledger).
3. Every ~2000 ledgers (~3 hours at 5 s/ledger):
   a. For each open claim where current_ledger < voting_deadline_ledger:
      - Query remaining TTL for ClaimVoters(claim_id).
      - If remaining_ttl < (voting_deadline_ledger - current_ledger) + LEDGERS_PER_WEEK:
          call refresh_snapshot(claim_id).
4. On ClaimStatus transition to any terminal state, remove claim from the watch list.
```

### Failure mode and recovery

If the snapshot is **already evicted** before a refresh is submitted:

- `refresh_snapshot` returns `VoterSnapshotExpired` — extending TTL is no longer possible.
- `vote_on_claim` also returns `VoterSnapshotExpired` for all voters.
- Recovery requires a **contract governance path** (upgrade / migration), not a keeper call.
- The claim record itself (`Claim` struct) is unaffected and remains in persistent storage.

This is a **non-recoverable keeper failure** for that claim. Prevent it by maintaining the
refresh cadence above.

### Fee budget

Each `refresh_snapshot` call only executes `extend_ttl` on one persistent key — it is among the
cheapest possible Soroban transactions. Budget accordingly (one XLM fee reserve per keeper
account is sufficient for thousands of refreshes).

## Acceptance mapping

| Requirement | Behavior |
|---|---|
| Votes with missing/expired snapshot | `vote_on_claim` → `VoterSnapshotExpired` (not `NotEligibleVoter`) |
| Refresh semantics | `extend_ttl` only; no change to voter `Vec` or vote counts |
| Permissionless | No `require_auth` on `refresh_snapshot` |
| Operational runbook | This document (keeper setup, failure mode, fee budget) |
