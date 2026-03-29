/**
 * Per-network manifest — single source of truth for RPC endpoints,
 * network passphrases, and contract IDs per deployment environment.
 *
 * Contract IDs are read from env vars so CI can inject the correct
 * addresses without rebuilding the manifest file.
 */

export type AppNetwork = 'testnet' | 'mainnet' | 'futurenet'

export interface NetworkManifest {
  networkPassphrase: string
  horizonUrl: string
  rpcUrl: string
  /** Average ledger close time in seconds — used by LedgerCountdown for time estimation. */
  avgLedgerCloseSeconds: number
  contractIds: {
    policy_contract_id: string
    claims_contract_id: string
  }
}

export const NETWORK_MANIFESTS: Record<AppNetwork, NetworkManifest> = {
  testnet: {
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    avgLedgerCloseSeconds: 5,
    contractIds: {
      policy_contract_id: process.env.NEXT_PUBLIC_POLICY_CONTRACT_ID_TESTNET ?? '',
      claims_contract_id: process.env.NEXT_PUBLIC_CLAIMS_CONTRACT_ID_TESTNET ?? '',
    },
  },
  mainnet: {
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
    rpcUrl: 'https://soroban-rpc.stellar.org',
    avgLedgerCloseSeconds: 5,
    contractIds: {
      policy_contract_id: process.env.NEXT_PUBLIC_POLICY_CONTRACT_ID_MAINNET ?? '',
      claims_contract_id: process.env.NEXT_PUBLIC_CLAIMS_CONTRACT_ID_MAINNET ?? '',
    },
  },
  futurenet: {
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    avgLedgerCloseSeconds: 5,
    contractIds: {
      policy_contract_id: process.env.NEXT_PUBLIC_POLICY_CONTRACT_ID_FUTURENET ?? '',
      claims_contract_id: process.env.NEXT_PUBLIC_CLAIMS_CONTRACT_ID_FUTURENET ?? '',
    },
  },
}

export function getManifest(network: AppNetwork): NetworkManifest {
  return NETWORK_MANIFESTS[network]
}

/**
 * Maps the exact network passphrase string returned by the wallet (via
 * `StellarWalletsKit.getNetwork()`) to our `AppNetwork` key.
 *
 * Comparison is **case-sensitive, full-string equality** against each manifest’s
 * `networkPassphrase` (Stellar’s canonical strings, e.g. Test SDF Network).
 *
 * **Custom RPC:** Changing the Soroban/Horizon RPC in Settings does not change
 * the wallet passphrase; mismatch detection is driven only by what the wallet
 * reports for the active network.
 *
 * **Unknown / private networks:** If the passphrase is not one of our three
 * manifests, this returns `null`. Callers should treat that as “wallet network
 * not supported by this app” (see `computeNetworkMismatch` in wallet utils).
 */
export function passphraseToAppNetwork(passphrase: string): AppNetwork | null {
  for (const [key, manifest] of Object.entries(NETWORK_MANIFESTS)) {
    if (manifest.networkPassphrase === passphrase) return key as AppNetwork
  }
  return null
}
