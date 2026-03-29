/**
 * Network configuration — single source of truth for multi-network deployments.
 *
 * Environment variable naming convention:
 *   STELLAR_NETWORK          — active network key: "testnet" | "mainnet" | "futurenet"
 *   SOROBAN_RPC_URL          — RPC endpoint for the active network
 *   HORIZON_URL              — Horizon endpoint for the active network
 *   STELLAR_NETWORK_PASSPHRASE — canonical passphrase for the active network
 *   CONTRACT_ID              — niffyinsure contract address on the active network
 *
 * Per-network overrides (used in multi-network CI):
 *   SOROBAN_RPC_URL_TESTNET / _MAINNET / _FUTURENET
 *   HORIZON_URL_TESTNET / _MAINNET / _FUTURENET
 *   CONTRACT_ID_TESTNET / _MAINNET / _FUTURENET
 */

export type StellarNetwork = 'testnet' | 'mainnet' | 'futurenet';

export interface NetworkConfig {
  network: StellarNetwork;
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  contractIds: {
    niffyinsure: string;
    defaultToken: string;
  };
}

const KNOWN_PASSPHRASES: Record<StellarNetwork, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
  futurenet: 'Test SDF Future Network ; October 2022',
};

const KNOWN_RPC_URLS: Record<StellarNetwork, string> = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban-rpc.stellar.org',
  futurenet: 'https://rpc-futurenet.stellar.org',
};

const KNOWN_HORIZON_URLS: Record<StellarNetwork, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
  futurenet: 'https://horizon-futurenet.stellar.org',
};

function env(key: string): string | undefined {
  return process.env[key];
}

function requireEnv(key: string): string {
  const val = env(key);
  if (!val) throw new Error(`[NetworkConfig] Missing required env var: ${key}`);
  return val;
}

/**
 * Loads and validates the network configuration at startup.
 * Throws with a clear message on any inconsistency.
 */
export function loadNetworkConfig(): NetworkConfig {
  const rawNetwork = (env('STELLAR_NETWORK') ?? 'testnet').toLowerCase();
  if (!['testnet', 'mainnet', 'futurenet'].includes(rawNetwork)) {
    throw new Error(
      `[NetworkConfig] STELLAR_NETWORK="${rawNetwork}" is not valid. ` +
        `Allowed values: testnet, mainnet, futurenet`,
    );
  }
  const network = rawNetwork as StellarNetwork;
  const suffix = network.toUpperCase();

  const rpcUrl =
    env(`SOROBAN_RPC_URL_${suffix}`) ??
    env('SOROBAN_RPC_URL') ??
    KNOWN_RPC_URLS[network];

  const horizonUrl =
    env(`HORIZON_URL_${suffix}`) ??
    env('HORIZON_URL') ??
    KNOWN_HORIZON_URLS[network];

  const networkPassphrase =
    env('STELLAR_NETWORK_PASSPHRASE') ?? KNOWN_PASSPHRASES[network];

  const contractId =
    env(`CONTRACT_ID_${suffix}`) ?? env('CONTRACT_ID') ?? '';

  const defaultToken =
    env(`DEFAULT_TOKEN_CONTRACT_ID_${suffix}`) ??
    env('DEFAULT_TOKEN_CONTRACT_ID') ??
    '';

  // Passphrase must match the canonical value for the declared network.
  const expectedPassphrase = KNOWN_PASSPHRASES[network];
  if (networkPassphrase !== expectedPassphrase) {
    throw new Error(
      `[NetworkConfig] STELLAR_NETWORK_PASSPHRASE mismatch for network "${network}". ` +
        `Expected: "${expectedPassphrase}", got: "${networkPassphrase}". ` +
        `Refusing to start to prevent cross-network data corruption.`,
    );
  }

  // Mainnet contract IDs must not be empty (fail-fast in production).
  if (network === 'mainnet' && !contractId) {
    throw new Error(
      `[NetworkConfig] CONTRACT_ID or CONTRACT_ID_MAINNET is required for mainnet deployments.`,
    );
  }

  return {
    network,
    rpcUrl,
    horizonUrl,
    networkPassphrase,
    contractIds: {
      niffyinsure: contractId,
      defaultToken,
    },
  };
}

/** Singleton — loaded once at process start. */
let _networkConfig: NetworkConfig | null = null;

export function getNetworkConfig(): NetworkConfig {
  if (!_networkConfig) {
    _networkConfig = loadNetworkConfig();
  }
  return _networkConfig;
}

/** Reset for testing only. */
export function _resetNetworkConfig(): void {
  _networkConfig = null;
}
