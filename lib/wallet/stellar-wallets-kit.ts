'use client';

import {
  StellarWalletsKit,
  FreighterModule,
  xBullModule,
  LobstrModule,
  WalletNetwork,
  defaultModules,
} from '@creit.tech/stellar-wallets-kit';

/**
 * Supported wallet ids. Kept in sync with the modules registered below.
 */
export type WalletId = 'freighter' | 'xbull' | 'lobstr';

export const SUPPORTED_WALLETS: { id: WalletId; name: string }[] = [
  { id: 'freighter', name: 'Freighter' },
  { id: 'xbull', name: 'xBull' },
  { id: 'lobstr', name: 'Lobstr' },
];

/**
 * localStorage key used to persist the last connected wallet id so that
 * `silentReconnect` can restore the session on reload without prompting.
 * Only the wallet id is stored — never seed phrases or private keys.
 */
export const WALLET_STORAGE_KEY = 'handsoff.wallet.id';

let initialized = false;

/**
 * Lazily initialize the Stellar Wallets Kit with the supported modules.
 * Safe to call multiple times; only the first call configures the kit.
 */
export function initWalletKit(network: WalletNetwork = WalletNetwork.TESTNET): StellarWalletsKit {
  if (!initialized) {
    StellarWalletsKit.init({
      network,
      selectedWalletId: undefined,
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new LobstrModule(),
        ...defaultModules(),
      ],
    });
    initialized = true;
  }
  return StellarWalletsKit;
}

/**
 * Returns true when the wallet extension is available in the current browser.
 * Used to render a non-blocking banner when the extension is missing.
 */
export function isWalletAvailable(id: WalletId): boolean {
  if (typeof window === 'undefined') return false;
  switch (id) {
    case 'freighter':
      return Boolean((window as any).freighterApi || (window as any).freighter);
    case 'xbull':
      return Boolean((window as any).xBullSDK || (window as any).xBullWalletConnect);
    case 'lobstr':
      return Boolean((window as any).lobstr);
    default:
      return false;
  }
}

/**
 * Persist the connected wallet id. Never store secrets here.
 */
export function persistWalletId(id: WalletId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WALLET_STORAGE_KEY, id);
  } catch {
    // Storage may be unavailable (private mode); ignore silently.
  }
}

/**
 * Read the persisted wallet id, if any.
 */
export function readPersistedWalletId(): WalletId | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (value === 'freighter' || value === 'xbull' || value === 'lobstr') {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear any persisted wallet state. Called on disconnect and on key mismatch.
 */
export function clearPersistedWallet(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Attempt to restore a session without prompting the user.
 * Returns the restored address, or null when no session can be restored.
 * On key mismatch the persisted state is cleared so the user is prompted
 * for a fresh connect.
 */
export async function silentReconnect(): Promise<{ address: string; walletId: WalletId } | null> {
  const walletId = readPersistedWalletId();
  if (!walletId) return null;

  if (!isWalletAvailable(walletId)) {
    // Extension unavailable — keep storage so a later reload can retry,
    // but do not prompt. The UI shows a non-blocking banner.
    return null;
  }

  try {
    const kit = initWalletKit();
    kit.setWallet(walletId);
    const { address } = await kit.getAddress();
    if (!address) {
      clearPersistedWallet();
      return null;
    }
    return { address, walletId };
  } catch {
    // Key mismatch or rejected restore: clear storage and require fresh connect.
    clearPersistedWallet();
    return null;
  }
}

/**
 * Prompt the user to connect a wallet. Persists the wallet id on success.
 */
export async function connectWallet(walletId: WalletId): Promise<string> {
  const kit = initWalletKit();
  kit.setWallet(walletId);
  const { address } = await kit.getAddress();
  if (!address) {
    throw new Error('Wallet did not return an address');
  }
  persistWalletId(walletId);
  return address;
}

/**
 * Disconnect the current wallet and clear persisted state.
 */
export async function disconnectWallet(): Promise<void> {
  try {
    const kit = initWalletKit();
    await kit.disconnect();
  } catch {
    // Ignore disconnect errors; storage is cleared regardless.
  } finally {
    clearPersistedWallet();
  }
}

/**
 * Sign a transaction XDR with the currently selected wallet.
 */
export async function signTransaction(xdr: string, address: string): Promise<string> {
  const kit = initWalletKit();
  const { signedTxXdr } = await kit.signTransaction(xdr, {
    address,
    networkPassphrase: WalletNetwork.TESTNET,
  });
  return signedTxXdr;
}
