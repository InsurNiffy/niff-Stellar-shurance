import type { AppNetwork } from '@/config/networkManifest'

const STELLAR_EXPERT_NETWORKS: Record<AppNetwork, string> = {
  mainnet: 'public',
  testnet: 'testnet',
  futurenet: 'futurenet',
}

/**
 * Returns the Stellar Expert URL for a given account address and network.
 * https://stellar.expert/explorer/<network>/account/<address>
 */
export function stellarExpertAccountUrl(address: string, network: AppNetwork): string {
  const net = STELLAR_EXPERT_NETWORKS[network] ?? 'testnet'
  return `https://stellar.expert/explorer/${net}/account/${address}`
}
