'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  StellarWalletsKit,
  FreighterModule,
  xBullModule,
  LobstrModule,
  WalletNetwork,
  type ISupportedWallet,
} from '@creit.tech/stellar-wallets-kit';

const STORAGE_KEY = 'wallet.session';

interface StoredSession {
  address: string;
  walletId: string;
}

interface WalletContextValue {
  address: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string }) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

let kitInitialized = false;
function getKit(): StellarWalletsKit {
  if (!kitInitialized) {
    StellarWalletsKit.init({
      network: WalletNetwork.TESTNET,
      modules: [new FreighterModule(), new xBullModule(), new LobstrModule()],
    });
    kitInitialized = true;
  }
  return StellarWalletsKit;
}

function readSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed || typeof parsed.address !== 'string' || typeof parsed.walletId !== 'string') {
      return null;
    }
    return { address: parsed.address, walletId: parsed.walletId };
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore storage failures
  }
}

function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

function isExtensionUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /not\s*(installed|available|found)|no\s*wallet|extension/i.test(message);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [extensionUnavailable, setExtensionUnavailable] = useState(false);
  const reconnectAttempted = useRef(false);

  const silentReconnect = useCallback(async () => {
    const session = readSession();
    if (!session) return;

    try {
      const kit = getKit();
      kit.setWallet(session.walletId);
      const { address: restored } = await kit.getAddress();

      if (!restored || restored !== session.address) {
        // Key mismatch: clear storage and require a fresh connect.
        clearSession();
        setAddress(null);
        setIsConnected(false);
        return;
      }

      setAddress(restored);
      setIsConnected(true);
    } catch (err) {
      clearSession();
      setAddress(null);
      setIsConnected(false);
      if (isExtensionUnavailable(err)) {
        setExtensionUnavailable(true);
      }
    }
  }, []);

  useEffect(() => {
    if (reconnectAttempted.current) return;
    reconnectAttempted.current = true;
    void silentReconnect();
  }, [silentReconnect]);

  const connect = useCallback(async () => {
    try {
      const kit = getKit();
      const { address: selected } = await kit.openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          kit.setWallet(option.id);
        },
      });

      if (!selected) return;

      const walletId = kit.getWalletId?.() ?? '';
      setAddress(selected);
      setIsConnected(true);
      setExtensionUnavailable(false);
      writeSession({ address: selected, walletId });
    } catch (err) {
      if (isExtensionUnavailable(err)) {
        setExtensionUnavailable(true);
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    clearSession();
    setAddress(null);
    setIsConnected(false);
  }, []);

  const signTransaction = useCallback(
    async (xdr: string, opts?: { networkPassphrase?: string }) => {
      const kit = getKit();
      const { signedTxXdr } = await kit.signTransaction(xdr, {
        networkPassphrase: opts?.networkPassphrase,
        address,
      });
      return signedTxXdr;
    },
    [address],
  );

  const value = useMemo<WalletContextValue>(
    () => ({ address, isConnected, connect, disconnect, signTransaction }),
    [address, isConnected, connect, disconnect, signTransaction],
  );

  return (
    <WalletContext.Provider value={value}>
      {extensionUnavailable && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            borderRadius: 8,
            background: '#1f2937',
            color: '#f9fafb',
            fontSize: 14,
            zIndex: 9999,
          }}
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
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return ctx;
}
