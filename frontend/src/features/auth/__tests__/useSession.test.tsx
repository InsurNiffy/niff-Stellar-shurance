/**
 * useSession tests (#1507):
 *  - sign-in success (challenge → sign → JWT)
 *  - user rejects the signature
 *  - expiry → refresh (httpOnly cookie path)
 *  - refresh failure → sign out
 *  - account switch → sign out + query cache flush
 *  - access token never persisted to localStorage
 */

import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSession, REFRESH_LEAD_MS } from '@/features/auth/hooks/useSession';
import { sessionStore } from '@/features/auth/session/sessionStore';

const ADDRESS_A = 'GADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADDRESS_B = 'GADDRESSBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

let mockAddress: string | null = ADDRESS_A;

jest.mock('@/features/wallet/context/WalletContext', () => ({
  useWalletContext: () => ({ address: mockAddress }),
}));

type FetchCall = { url: string; init?: RequestInit };

function makeToken(expiresInSeconds: number, address = ADDRESS_A): string {
  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: address,
    walletAddress: address,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
  return `${header}.${payload}.signature`;
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 401) {
  return { ok, status, json: async () => body } as Response;
}

function installFetchMock(handlers: Record<string, () => unknown>) {
  const calls: FetchCall[] = [];
  const mock = jest.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    for (const [fragment, handler] of Object.entries(handlers)) {
      if (String(url).includes(fragment)) {
        const value = handler();
        const isResponse =
          value !== null &&
          typeof value === 'object' &&
          'ok' in value &&
          typeof (value as { json?: unknown }).json === 'function';
        return Promise.resolve(
          isResponse ? (value as Response) : jsonResponse(value),
        );
      }
    }
    return Promise.resolve(jsonResponse({}, false, 404));
  });
  (global as unknown as { fetch: unknown }).fetch = mock;
  return { mock, calls };
}

const acceptedSigner = jest.fn().mockResolvedValue('base64-signature');
const rejectingSigner = jest.fn().mockRejectedValue(new Error('User rejected the request'));

function renderSession(signMessage?: typeof acceptedSigner) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const clearSpy = jest.spyOn(queryClient, 'clear');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = renderHook(() => useSession(signMessage ? { signMessage } : {}), {
    wrapper,
  });
  return { ...utils, clearSpy, queryClient };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddress = ADDRESS_A;
  sessionStore.clear();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  sessionStore.clear();
});

describe('useSession — sign-in success (#1507)', () => {
  it('runs challenge → sign → verify and authenticates', async () => {
    const token = makeToken(900);
    const { calls } = installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-1', message: 'Sign in to Niffy', expiresAt: '' }),
      '/auth/verify': () => ({ token, expiresAt: '', refreshToken: 'refresh-1' }),
    });

    const { result } = renderSession(acceptedSigner);

    let ok = false;
    await act(async () => {
      ok = await result.current.signIn();
    });

    expect(ok).toBe(true);
    expect(acceptedSigner).toHaveBeenCalledWith('Sign in to Niffy', ADDRESS_A);
    expect(result.current.status).toBe('authenticated');
    expect(result.current.address).toBe(ADDRESS_A);
    expect(result.current.error).toBeNull();

    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.includes('/auth/nonce'))).toBe(true);
    expect(urls.some((u) => u.includes('/auth/verify'))).toBe(true);

    const verifyCall = calls.find((c) => c.url.includes('/auth/verify'));
    expect(JSON.parse(String(verifyCall?.init?.body))).toEqual({
      address: ADDRESS_A,
      nonce: 'nonce-1',
      signature: 'base64-signature',
    });
  });

  it('keeps the access token in memory — never in localStorage/sessionStorage', async () => {
    const token = makeToken(900);
    installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-2', message: 'msg', expiresAt: '' }),
      '/auth/verify': () => ({ token, refreshToken: 'refresh-2' }),
    });

    const { result } = renderSession(acceptedSigner);
    await act(async () => {
      await result.current.signIn();
    });

    expect(sessionStore.getSnapshot().accessToken).toBe(token);
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('requires a connected wallet', async () => {
    mockAddress = null;
    const { calls } = installFetchMock({});
    const { result } = renderSession(acceptedSigner);

    let ok = true;
    await act(async () => {
      ok = await result.current.signIn();
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe('unauthenticated');
    expect(calls).toHaveLength(0);
  });
});

describe('useSession — user rejects the signature (#1507)', () => {
  it('stays unauthenticated with an explanatory error', async () => {
    const { calls } = installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-3', message: 'msg', expiresAt: '' }),
    });

    const { result } = renderSession(rejectingSigner);

    let ok = true;
    await act(async () => {
      ok = await result.current.signIn();
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.error).toMatch(/rejected the signature/i);
    expect(sessionStore.getSnapshot().accessToken).toBeNull();
    expect(calls.some((c) => c.url.includes('/auth/verify'))).toBe(false);
  });

  it('surfaces backend failures as a generic error', async () => {
    installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-4', message: 'msg', expiresAt: '' }),
      '/auth/verify': () => jsonResponse({}, false, 401),
    });

    const { result } = renderSession(acceptedSigner);
    await act(async () => {
      await result.current.signIn();
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.error).toBeTruthy();
    expect(sessionStore.getSnapshot().accessToken).toBeNull();
  });
});

describe('useSession — expiry → refresh (#1507)', () => {
  it('refreshes the token ahead of expiry and stays authenticated', async () => {
    jest.useFakeTimers();
    const shortLived = makeToken(REFRESH_LEAD_MS / 1000 + 30); // expires in 60s
    const rotated = makeToken(900);
    const { calls } = installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-5', message: 'msg', expiresAt: '' }),
      '/auth/verify': () => ({ token: shortLived, refreshToken: 'refresh-5' }),
      '/auth/refresh': () => ({ token: rotated, refreshToken: 'refresh-6' }),
    });

    const { result } = renderSession(acceptedSigner);
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.status).toBe('authenticated');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(REFRESH_LEAD_MS);
    });

    expect(calls.some((c) => c.url.includes('/auth/refresh'))).toBe(true);
    expect(sessionStore.getSnapshot().accessToken).toBe(rotated);
    expect(result.current.status).toBe('authenticated');
  });

  it('signs out when the refresh is rejected', async () => {
    jest.useFakeTimers();
    const shortLived = makeToken(REFRESH_LEAD_MS / 1000 + 30);
    installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-6', message: 'msg', expiresAt: '' }),
      '/auth/verify': () => ({ token: shortLived, refreshToken: 'refresh-7' }),
      '/auth/refresh': () => jsonResponse({}, false, 401),
    });

    const { result, clearSpy } = renderSession(acceptedSigner);
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.status).toBe('authenticated');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(REFRESH_LEAD_MS);
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(sessionStore.getSnapshot().accessToken).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('useSession — account switch (#1507)', () => {
  it('signs out and clears the query cache when the wallet address changes', async () => {
    const token = makeToken(900);
    installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-7', message: 'msg', expiresAt: '' }),
      '/auth/verify': () => ({ token, refreshToken: 'refresh-8' }),
    });

    const { result, rerender, clearSpy } = renderSession(acceptedSigner);
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.status).toBe('authenticated');
    expect(clearSpy).not.toHaveBeenCalled();

    await act(async () => {
      mockAddress = ADDRESS_B;
      rerender();
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.address).toBeNull();
    expect(sessionStore.getSnapshot().accessToken).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('signs out when the wallet disconnects', async () => {
    const token = makeToken(900);
    installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-8', message: 'msg', expiresAt: '' }),
      '/auth/verify': () => ({ token, refreshToken: 'refresh-9' }),
    });

    const { result, rerender, clearSpy } = renderSession(acceptedSigner);
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.status).toBe('authenticated');

    await act(async () => {
      mockAddress = null;
      rerender();
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(clearSpy).toHaveBeenCalled();
  });

  it('signOut clears the in-memory token immediately', async () => {
    const token = makeToken(900);
    installFetchMock({
      '/auth/nonce': () => ({ nonce: 'nonce-9', message: 'msg', expiresAt: '' }),
      '/auth/verify': () => ({ token, refreshToken: 'refresh-a' }),
    });

    const { result, clearSpy } = renderSession(acceptedSigner);
    await act(async () => {
      await result.current.signIn();
    });

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(sessionStore.getSnapshot().accessToken).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
    expect(JSON.stringify(localStorage)).not.toContain(token);
  });
});
