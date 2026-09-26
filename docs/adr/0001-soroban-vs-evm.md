# ADR-0001: Use Soroban (Stellar) instead of an EVM-compatible chain

**Status:** Accepted

**Date:** 2024-01-15

**Deciders:** core team

---

## Context

niff-Stellar-shurance is a decentralised parametric insurance protocol that must execute claim payouts automatically when on-chain conditions are met. We needed to pick a smart-contract platform before writing any contract code. The main candidates evaluated were:

- **Soroban** — Stellar's Rust/WASM smart-contract layer (then in public testnet, now on mainnet)
- **EVM chains** — Ethereum mainnet or an L2 (Arbitrum, Base, Optimism) using Solidity/Vyper

The protocol's primary audience is users who already hold Stellar-native assets (XLM, USDC via Stellar), and several data-oracle providers we intended to use were already integrating Soroban.

## Decision

We build on **Soroban on Stellar mainnet**.

Soroban provides a deterministic, resource-metered WASM runtime that is co-designed with Stellar's fast-finality consensus (~5 s). Fees are predictable, storage costs are explicit (rent model), and the Rust SDK gives us type-safe contract interfaces and built-in fuzzing support. Stellar's existing asset infrastructure (Stellar Asset Contract, Stellar DEX liquidity) means we can hold and disburse stablecoin premiums without bridging.

## Consequences

### Positive
- Sub-dollar transaction fees and ~5 s finality make micro-premium policies economically viable.
- Rust contract code integrates naturally with our `cargo fuzz` harness and Clippy lint gates.
- Stellar Asset Contract lets us operate with USDC directly on-chain — no wrapped token complexity.
- Soroban's storage rent model forces explicit state hygiene, reducing attack surface from unbounded state growth.

### Negative
- Soroban tooling (Stellar CLI, JS SDK) is younger than EVM tooling; breaking changes occurred during testnet.
- Fewer auditors have Soroban expertise compared with Solidity, raising audit cost and lead time.
- No EVM wallet (MetaMask) support; users must use Freighter or a Stellar-compatible wallet.

### Neutral / mitigations
- We pin the `stellar-sdk` JS package and `stellar-cli` binary to exact versions in CI (see ADR-0003) to insulate from mid-sprint breaking changes.
- We maintain a `contracts/deployment-registry.json` to track deployed contract addresses and WASM hashes across environments.

## Alternatives considered

| Option | Why rejected |
|--------|-------------|
| Ethereum mainnet (Solidity) | Gas fees ($10–$100 per transaction) make micro-premium policies uneconomical for the target market |
| Arbitrum / Base (EVM L2) | Better fees than mainnet but adds bridge trust assumptions; Stellar users would still need on-ramp |
| Algorand (PyTEAL / ARC-4) | Good fee model but very small oracle ecosystem; insufficient tooling for parametric triggers at the time of evaluation |
| CosmWasm (Cosmos chain) | Strong Rust story but no native stablecoin liquidity comparable to Stellar USDC; IBC bridging adds complexity |
