export type StellarNetwork = "mainnet" | "testnet" | "futurenet";

const HORIZON_URLS: Record<StellarNetwork, string> = {
  mainnet: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

const STELLAR_EXPERT_URLS: Record<StellarNetwork, string> = {
  mainnet: "https://stellar.expert/explorer/public",
  testnet: "https://stellar.expert/explorer/testnet",
  futurenet: "https://stellar.expert/explorer/futurenet",
};

export function getHorizonUrl(network: StellarNetwork): string {
  return HORIZON_URLS[network] ?? HORIZON_URLS.testnet;
}

export function getStellarExpertUrl(network: StellarNetwork): string {
  return STELLAR_EXPERT_URLS[network] ?? STELLAR_EXPERT_URLS.testnet;
}

/**
 * Returns the Stellar Expert account/contract URL for an address, or null when
 * the address is not a valid G-address (account) or C-address (contract).
 */
export function getExplorerAccountUrl(
  address: string,
  network: StellarNetwork,
): string | null {
  if (!isValidStellarAddress(address)) return null;
  const base = getStellarExpertUrl(network);
  const kind = address.startsWith("C") ? "contract" : "account";
  return `${base}/${kind}/${address}`;
}

/**
 * Validates a Stellar G-address (account) or C-address (contract).
 * Both are 56-character base32 strings starting with G or C respectively.
 */
export function isValidStellarAddress(address: string): boolean {
  if (typeof address !== "string") return false;
  if (!/^[GC][A-Z2-7]{55}$/.test(address)) return false;
  return true;
}

/**
 * Truncates a Stellar address to first 4 / last 4 characters with an ellipsis.
 * Returns the input unchanged when it is too short to truncate.
 */
export function truncateAddress(address: string): string {
  if (typeof address !== "string") return "";
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
