# Environment Variables

This document describes the environment variables used by the backend.

## Multi-network configuration

The backend can operate against multiple Stellar networks (Futurenet, Testnet,
Mainnet) simultaneously. Each network is configured through a set of
environment variables that share a common prefix so that environments stay
strictly isolated.

### Naming convention

```
STELLAR_<NETWORK>_RPC_URL
STELLAR_<NETWORK>_HORIZON_URL
STELLAR_<NETWORK>_NETWORK_PASSPHRASE
STELLAR_<NETWORK>_CONTRACT_<CONTRACT_NAME>
```

Where `<NETWORK>` is one of `FUTURENET`, `TESTNET`, or `MAINNET` (uppercase),
and `<CONTRACT_NAME>` is the uppercase contract identifier (for example
`RAMP`, `PRIVACY`, `ESCROW`).

### Example

```dotenv
# Testnet
STELLAR_TESTNET_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_TESTNET_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_TESTNET_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_TESTNET_CONTRACT_RAMP=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4

# Mainnet
STELLAR_MAINNET_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<key>
STELLAR_MAINNET_HORIZON_URL=https://horizon.stellar.org
STELLAR_MAINNET_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
STELLAR_MAINNET_CONTRACT_RAMP=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

### Validation rules

At startup the backend loads every configured network into a `NetworkConfig`
(`rpcUrl`, `horizonUrl`, `networkPassphrase`, `contractIds`) and validates it:

- All required variables for a network must be present; a missing value fails
  startup with a clear error naming the offending variable.
- The RPC endpoint's reported network passphrase must match the configured
  `STELLAR_<NETWORK>_NETWORK_PASSPHRASE`. A mismatch (for example, Mainnet
  contract IDs paired with a Testnet RPC URL) fails startup.
- Contract IDs are scoped to their network; a contract ID configured for one
  network cannot be used against another network's RPC.

The active network is logged prominently at startup so operators can confirm
which environment the process is serving.
