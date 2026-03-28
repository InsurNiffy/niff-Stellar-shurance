# Claim voter snapshot TTL and `refresh_snapshot`

## Why this exists

Eligible voters for a claim are stored in persistent Soroban storage (`ClaimVoters(claim_id)`), captured at `file_claim`. Persistent entries have a **ledger TTL**; when TTL is exhausted the entry is **archived/evicted** and reads behave as if the key is absent.

Without an explicit check, a missing snapshot could be treated like an empty electorate and block legitimate voters with `NotEligibleVoter`. The contract now:

- Uses **dedicated TTL constants** for snapshot keys (aligned with the maximum configured voting window plus margin).
- Exposes a **permissionless** `refresh_snapshot(claim_id)` that only calls `extend_ttl` on the existing snapshot (no rewrite of voters or votes).
- Reverts `vote_on_claim` with **`VoterSnapshotExpired` (contract error code 51)** when the voting window is still open but the snapshot entry is missing.

**Spec note:** Soroban caps how many variants a single `contracterror` enum may export. Codes **43–48** were previously reserved for future appeal flows that are not implemented on-chain yet; they were removed from the exported error enum so **51** could be added. Re-introduce appeal errors in a future upgrade when appeal entrypoints ship.

## Constants (contract)

Defined in `storage.rs`:

- `CLAIM_VOTER_SNAPSHOT_EXTEND_TO` — target minimum remaining TTL after extension, set to `MAX_VOTING_DURATION_LEDGERS + 3 * LEDGERS_PER_WEEK`.
- `CLAIM_VOTER_SNAPSHOT_TTL_THRESHOLD` — `MAX_VOTING_DURATION_LEDGERS + LEDGERS_PER_WEEK`, used with `extend_ttl` so extensions engage before the snapshot falls out of the “long vote” regime.

These track **admin-configurable voting duration bounds** in `ledger.rs` (`MAX_VOTING_DURATION_LEDGERS` is currently eight nominal weeks at ~5 s/ledger).

## Stellar / Soroban guidance

TTL and rent-style archival are network- and protocol-defined. Operators should follow current Stellar documentation for **persistent storage TTL** and **state archival** when planning keeper cadence and fee budgets:

https://developers.stellar.org/docs/learn/smart-contract-internals/state-archival

## Recommended refresh cadence

**Goal:** the `ClaimVoters` entry must remain live through `voting_deadline_ledger` while votes can still be cast.

Practical approach:

1. Compute the claim’s `voting_deadline_ledger` (from `get_claim` or events).
2. Schedule permissionless `refresh_snapshot(claim_id)` **well before** remaining snapshot TTL could drop below `(voting_deadline_ledger - current_ledger)` plus a safety margin.
3. A simple heuristic: refresh at least **once per nominal week** for any claim still in `Processing` with an open voting window, and more often if the network’s max TTL per extension is tight relative to your voting duration.

Exact ledger numbers depend on the network and current Soroban TTL rules; monitors should use RPC or indexers that expose **remaining TTL** for contract keys where available.

## Who runs keepers

- **Permissionless:** any account may call `refresh_snapshot`; no admin auth.
- **Operational owner:** the protocol / DAO ops team (or an automated service they run) should **monitor** open claims and **submit** refreshes on a schedule.
- **Failure mode:** if the snapshot is already evicted, `refresh_snapshot` and `vote_on_claim` return **`VoterSnapshotExpired`**. Extending TTL is no longer possible for that key; recovery requires a **contract governance** path (upgrade/migration), not a keeper call.

## Acceptance mapping

| Requirement | Behavior |
|-------------|----------|
| Votes with missing/expired snapshot | `vote_on_claim` → `VoterSnapshotExpired` (not `NotEligibleVoter`). |
| Refresh semantics | `extend_ttl` only; no change to voter `Vec` or vote counts. |
| Permissionless | No `require_auth` on `refresh_snapshot`. |
