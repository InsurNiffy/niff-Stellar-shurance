/**
 * Network manifest — single source of truth for contract addresses.
 * Pulled from contracts/deployment-registry.json so docs and the app
 * never drift from the backend deployment registry.
 */
import registry from '../../../contracts/deployment-registry.json'

export type Network = 'testnet' | 'mainnet' | 'futurenet'

export interface ContractEntry {
  name: string
  contractId: string
  expectedWasmHash: string
  deployedAt: string
  stellarExpertUrl: string
}

const EXPLORER: Record<Network, string> = {
  testnet: 'https://stellar.expert/explorer/testnet/contract',
  mainnet: 'https://stellar.expert/explorer/public/contract',
  futurenet: 'https://stellar.expert/explorer/futurenet/contract',
}

export function getContracts(network: Network): ContractEntry[] {
  const networkEntry = registry.networks[network]
  if (!networkEntry) return []
  return networkEntry.contracts.map((c) => ({
    name: c.name,
    contractId: c.contractId,
    expectedWasmHash: c.expectedWasmHash,
    deployedAt: c.deployedAt,
    stellarExpertUrl: `${EXPLORER[network]}/${c.contractId}`,
  }))
}
