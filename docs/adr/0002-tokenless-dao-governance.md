# ADR-0002: Tokenless DAO governance model

**Status:** Accepted

**Date:** 2024-02-10

**Deciders:** core team

---

## Context

Claim disputes in a parametric insurance protocol require a human-judgement layer for edge cases where the on-chain oracle data is ambiguous or contested. We needed a governance model for who votes, how votes are weighted, and how quorum and dispute resolution work.

Two broad approaches were on the table:

1. **Token-weighted voting** — issue a protocol governance token; holders vote in proportion to their stake.
2. **Tokenless / role-based voting** — assign voting rights to registered voters (policyholders, approved community members) without a transferable token.

A secondary concern was regulatory exposure: a freely transferable governance token could be classified as a security in several jurisdictions, requiring registration or restricting who can participate.

## Decision

We adopt a **tokenless DAO governance model** in which voting rights are non-transferable and tied to verified participation in the protocol.

Eligible voters are:
- Active policyholders (verified on-chain by the Soroban contract).
- Community reviewers approved by a multisig admin quorum.

Each eligible address carries **one vote** (equal weight). Quorum thresholds and dispute windows are configurable by the admin multisig and stored on-chain.

The backend (`backend/src/governance/`) enforces eligibility checks against the Soroban contract state before accepting votes. The frontend shows real-time quorum progress via the `QuorumProgressBar` component.

## Consequences

### Positive
- No token launch reduces regulatory risk and eliminates token sale complexity.
- One-person-one-vote prevents wealthy actors from buying governance outcomes on contentious claims.
- Voting rights automatically expire with policy expiry — no stale-voter problem.
- Simpler on-chain state: no ERC-20/SAC token contract needed for governance.

### Negative
- Sybil resistance depends on wallet-level identity checks, not economic stake — a determined actor could create many wallets and purchase cheap policies.
- Community reviewer admission still requires a centralised multisig step, limiting fully trustless governance.
- Voter apathy is harder to combat without token incentives.

### Neutral / mitigations
- Sybil risk is partially mitigated by the non-zero premium cost of purchasing a policy and by off-chain KYC gating for large-coverage policies.
- Future ADR may introduce reputation scoring or staking-without-token mechanisms if apathy becomes a problem.
- Admin multisig key rotation procedure is documented in `backend/docs/admin-role-assignment.md`.

## Alternatives considered

| Option | Why rejected |
|--------|-------------|
| Governance token (ERC-20 style on Stellar via SAC) | Securities-law exposure; plutocratic voting dynamics; token sale distraction from core product |
| Vetoken (vote-escrowed, time-locked) | Adds smart-contract complexity; still a transferable token at root; same regulatory risk |
| Prediction-market resolution (e.g. UMA-style) | High complexity; requires external liquidity; latency too high for time-sensitive claim windows |
| Delegated proof-of-stake validator set | Requires separate validator incentive layer; out of scope for v1 |
