export type Network = "testnet" | "mainnet";

export const DEFAULT_NETWORK: Network = "testnet";

const EXPLORER_BASE: Record<Network, string> = {
  testnet: "https://stellar.expert/explorer/testnet",
  mainnet: "https://stellar.expert/explorer/public",
};

/**
 * Resolve the currently configured network.
 * Falls back to DEFAULT_NETWORK when no explicit override is provided.
 */
export function getNetwork(): Network {
  const configured = process.env.NEXT_PUBLIC_NETWORK;
  if (configured === "mainnet" || configured === "testnet") {
    return configured;
  }
  return DEFAULT_NETWORK;
}

/**
 * Build an explorer URL for a transaction hash on the given (or configured) network.
 */
export function getExplorerUrl(
  txHash: string,
  network: Network = getNetwork(),
): string {
  const base = EXPLORER_BASE[network] ?? EXPLORER_BASE[DEFAULT_NETWORK];
  return `${base}/tx/${txHash}`;
}
