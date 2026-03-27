/**
 * Network manifest — single source of truth for contract addresses.
 * Pulled from contracts/deployment-registry.json so docs and the app
 * never drift from the backend deployment registry.
 */
import registry from '../../../contracts/deployment-registry.json'

export type Network = 'testnet' | 'public'

export interface ContractEntry {
  name: string
  contractId: string
  expectedWasmHash: string
  deployedAt: string
  stellarExpertUrl: string
}

const EXPLORER: Record<Network, string> = {
  testnet: 'https://stellar.expert/explorer/testnet/contract',
  public: 'https://stellar.expert/explorer/public/contract',
}

export function getContracts(network: Network): ContractEntry[] {
  return registry.contracts.map((c) => ({
    name: c.name,
    contractId: c.contractId,
    expectedWasmHash: c.expectedWasmHash,
    deployedAt: c.deployedAt,
    stellarExpertUrl: `${EXPLORER[network]}/${c.contractId}`,
  }))
}
