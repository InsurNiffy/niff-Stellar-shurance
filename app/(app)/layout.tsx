'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  StellarWalletsKit,
  FreighterModule,
  xBullModule,
  LobstrModule,
  WalletNetwork,
} from '@creit.tech/stellar-wallets-kit';

const STORAGE_KEY = 'wallet.session';

// App-configured network. Wallet-reported passphrase is compared against this.
const APP_NETWORK_PASSPHRASE = WalletNetwork.TESTNET;

interface WalletSession {
  address: string;
  walletId: string;
}

interface WalletContextValue {
  address: string | null;
  isConnected: boolean;
  networkMismatch: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function readSession(): WalletSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WalletSession>;
    if (!parsed?.address || !parsed?.walletId) return null;
    return { address: parsed.address, walletId: parsed.walletId };
  } catch {
    return null;
  }
}

function clearSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function writeSession(session: WalletSession) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function initKit() {
  StellarWalletsKit.init({
    network: APP_NETWORK_PASSPHRASE,
    modules: [new FreighterModule(), new xBullModule(), new LobstrModule()],
  });
}

// Compare the wallet-reported network passphrase against the app config.
// Returns true when the wallet is on a different network than the app expects.
function detectMismatch(walletPassphrase: string | undefined | null): boolean {
  if (!walletPassphrase) return false;
  return walletPassphrase !== APP_NETWORK_PASSPHRASE;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [extensionAvailable, setExtensionAvailable] = useState(true);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const kitReady = useRef(false);

  const ensureKit = useCallback(() => {
    if (!kitReady.current) {
      initKit();
      kitReady.current = true;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearSession();
    setAddress(null);
    setNetworkMismatch(false);
  }, []);

  // Re-check the wallet network on every wallet event.
  const checkNetwork = useCallback(async () => {
    try {
      const { networkPassphrase } = await StellarWalletsKit.getNetwork();
      setNetworkMismatch(detectMismatch(networkPassphrase));
    } catch {
      // Unable to read network: do not block on unknown state.
      setNetworkMismatch(false);
    }
  }, []);

  const connect = useCallback(async () => {
    ensureKit();
    try {
      const { address: selected } = await StellarWalletsKit.authModal();
      if (!selected) return;
      const walletId = StellarWalletsKit.selectedModule?.productId ?? 'unknown';
      writeSession({ address: selected, walletId });
      setAddress(selected);
      setExtensionAvailable(true);
      await checkNetwork();
    } catch {
      setExtensionAvailable(false);
    }
  }, [ensureKit, checkNetwork]);

  const signTransaction = useCallback(
    async (xdr: string) => {
      ensureKit();
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        address,
        networkPassphrase: APP_NETWORK_PASSPHRASE,
      });
      return signedTxXdr;
    },
    [address, ensureKit],
  );

  // Silent reconnect: restore session on mount without prompting.
  useEffect(() => {
    const session = readSession();
    if (!session) return;
    ensureKit();
    let cancelled = false;
    (async () => {
      try {
        StellarWalletsKit.setWallet(session.walletId);
        const { address: current } = await StellarWalletsKit.getAddress();
        if (cancelled) return;
        if (!current || current !== session.address) {
          // Key mismatch: clear storage and require a fresh connect.
          clearSession();
          setAddress(null);
          return;
        }
        setAddress(current);
        await checkNetwork();
      } catch {
        if (cancelled) return;
        clearSession();
        setAddress(null);
        setExtensionAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureKit, checkNetwork]);

  // Poll the wallet network while connected so the overlay dismisses
  // automatically once the user switches to the correct network.
  useEffect(() => {
    if (!address) return;
    const interval = window.setInterval(() => {
      void checkNetwork();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [address, checkNetwork]);

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      isConnected: Boolean(address),
      networkMismatch,
      connect,
      disconnect,
      signTransaction,
    }),
    [address, networkMismatch, connect, disconnect, signTransaction],
  );

  return (
    <WalletContext.Provider value={value}>
      {!extensionAvailable && (
        <div
          role="status"
          className="w-full bg-amber-100 px-4 py-2 text-center text-sm text-amber-900"
        >
          Wallet extension not detected. Install Freighter, xBull, or Lobstr to connect.
        </div>
      )}
      {networkMismatch && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="network-mismatch-title"
          aria-describedby="network-mismatch-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2
              id="network-mismatch-title"
              className="text-lg font-semibold text-gray-900"
            >
              Wrong network
            </h2>
            <p
              id="network-mismatch-desc"
              className="mt-2 text-sm text-gray-700"
            >
              Your wallet is connected to a different network than this app. Switch
              your wallet to the correct network to continue.
            </p>
            <button
              type="button"
              autoFocus
              onClick={() => void checkNetwork()}
              className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Switch Network
            </button>
          </div>
        </div>
      )}
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within AppLayout');
  return ctx;
}
