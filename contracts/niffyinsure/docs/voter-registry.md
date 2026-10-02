# Voter registry storage (Issue #1438)

The eligible-voter set is stored in fixed-size instance buckets
(`DataKey::VoterBucket(i)`, capacity 64) with `VoterBucketCount`,
`VoterRegistryLen`, and `VoterMember(Address)` for O(1) membership.

## Sybil-resistance assumption

Voting rights are **one address per active policy holder**. An address is
added when it first binds an active policy (or via admin `add_voters_batch`)
and removed when its active-policy count reaches zero.

The contract does **not** prove that distinct addresses are distinct people.
Known limits: wallet farming can inflate the registry; `MAX_ELIGIBLE_VOTERS`
(5000) and `max_voters_per_claim` bound gas and per-claim electorate size
only. See [ADR-0002](../../../docs/adr/0002-tokenless-dao-governance.md).

## Legacy migration

If a single legacy `DataKey::Voters` vector is present, the first registry
read/write redistributes those addresses into buckets and deletes the
legacy key.
