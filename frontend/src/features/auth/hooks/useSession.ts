'use client';

/**
 * useSession — wallet sign-in session for #1507.
 *
 * - signIn(): challenge → sign → JWT, loading + error states exposed
 * - signOut(): clears the in-memory token and the query cache
 * - status / address: derived session state
 * - Access token is kept in memory only (never localStorage)
 * - Refreshes the JWT before expiry using the httpOnly refresh cookie
 * - Signs out + flushes the query cache when the wallet account changes
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWalletContext } from '@/features/wallet/context/WalletContext';
import { msUntilExpiry, sessionStore } from '../session/sessionStore';
import {
  refreshAccessToken,
  requestChallenge,
  revokeSession,
  verifyChallenge,
} from '../session/authApi';
import { isUserRejection, SignMessageFn, signWithWallet } from '../session/walletSigner';

export type SessionStatus = 'authenticated' | 'unauthenticated' | 'loading';

/** Refresh the JWT this long before it expires. */
export const REFRESH_LEAD_MS = 30_000;

export interface UseSessionOptions {
  /** Override the wallet signer (tests, alternate wallet stacks). */
  signMessage?: SignMessageFn;
}

export interface UseSessionResult {
  status: SessionStatus;
  address: string | null;
  error: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

export function useSession(options: UseSessionOptions = {}): UseSessionResult {
  const { address: walletAddress } = useWalletContext();
  const queryClient = useQueryClient();
  const signMessage = options.signMessage ?? signWithWallet;

  const session = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getSnapshot,
  );

  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const status: SessionStatus = signingIn
    ? 'loading'
    : session.accessToken && session.address
      ? 'authenticated'
      : 'unauthenticated';

  const signOut = useCallback(async () => {
    const { refreshToken } = sessionStore.getSnapshot();
    sessionStore.clear();
    setError(null);
    queryClient.clear();
    await revokeSession(refreshToken);
  }, [queryClient]);

  const signIn = useCallback(async (): Promise<boolean> => {
    if (!walletAddress) {
      setError('Connect a wallet before signing in.');
      return false;
    }
    setSigningIn(true);
    setError(null);
    try {
      const challenge = await requestChallenge(walletAddress);
      const signature = await signMessage(challenge.message, walletAddress);
      const tokens = await verifyChallenge({
        address: walletAddress,
        nonce: challenge.nonce,
        signature,
      });
      if (!tokens.token) throw new Error('Authentication failed');
      sessionStore.setSession({
        accessToken: tokens.token,
        refreshToken: tokens.refreshToken ?? null,
        address: walletAddress,
      });
      return true;
    } catch (err) {
      sessionStore.clear();
      setError(
        isUserRejection(err)
          ? 'You rejected the signature request.'
          : err instanceof Error
            ? err.message
            : 'Sign-in failed. Please try again.',
      );
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [walletAddress, signMessage]);

  // Account change → sign out + flush the query cache (#1507).
  useEffect(() => {
    const sessionAddress = sessionStore.getSnapshot().address;
    if (!sessionAddress) return;
    if (walletAddress !== sessionAddress) {
      void signOut();
    }
  }, [walletAddress, session.address, signOut]);

  // Expiry → refresh (httpOnly cookie), or sign out when refresh fails.
  useEffect(() => {
    const token = session.accessToken;
    if (!token || !session.address) return;

    const delay = Math.max(0, msUntilExpiry(token) - REFRESH_LEAD_MS);
    const timer = setTimeout(() => {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      void (async () => {
        try {
          const { refreshToken } = sessionStore.getSnapshot();
          const fresh = await refreshAccessToken(refreshToken);
          if (fresh && sessionStore.getSnapshot().accessToken) {
            sessionStore.setAccessToken(fresh);
          } else {
            await signOut();
          }
        } finally {
          refreshInFlight.current = false;
        }
      })();
    }, delay);

    return () => clearTimeout(timer);
  }, [session.accessToken, session.address, signOut]);

  return { status, address: session.address, error, signIn, signOut };
}
