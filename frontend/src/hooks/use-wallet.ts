'use client';

import { useState, useCallback } from 'react';

export interface WalletState {
  address: string | null;
  connected: boolean;
  isConnecting: boolean;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW', // Mock address
    connected: true,
    isConnecting: false,
  });

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, isConnecting: true }));
    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setState({
      address: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
      connected: true,
      isConnecting: false,
    });
  }, []);

  const disconnect = useCallback(() => {
    setState({
      address: null,
      connected: false,
      isConnecting: false,
    });
  }, []);

  const signTransaction = useCallback(async (unsignedXdr: string) => {
    // Simulate signing delay
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // In a real app, this would use a wallet extension to sign the XDR
    return unsignedXdr; // Mock: return the same XDR as if signed (for simulator compatibility)
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    signTransaction,
  };
}
