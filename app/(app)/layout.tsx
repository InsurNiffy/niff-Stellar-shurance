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

interface WalletSession {
  address: string;
  walletId: string;
}

interface WalletContextValue {
  address: string | null;
  isConnected: boolean;
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
    network: WalletNetwork.TESTNET,
    modules: [new FreighterModule(), new xBullModule(), new LobstrModule()],
  });
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [extensionAvailable, setExtensionAvailable] = useState(true);
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
    } catch {
      setExtensionAvailable(false);
    }
  }, [ensureKit]);

  const signTransaction = useCallback(
    async (xdr: string) => {
      ensureKit();
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        address,
        networkPassphrase: WalletNetwork.TESTNET,
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
  }, [ensureKit]);

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      isConnected: Boolean(address),
      connect,
      disconnect,
      signTransaction,
    }),
    [address, connect, disconnect, signTransaction],
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
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within AppLayout');
  return ctx;
}
