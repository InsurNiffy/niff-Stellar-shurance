/**
 * Backend auth API client (#1507).
 *
 * Flow: challenge → sign → verify (JWT) → refresh via httpOnly cookie.
 * The access token returned by these calls is stored in memory only.
 */

function apiBase(): string {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  return `${origin}/api/v1`;
}

async function toJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export interface Challenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

/** GET /api/v1/auth/nonce — issues the domain-bound challenge to sign. */
export async function requestChallenge(address: string): Promise<Challenge> {
  const res = await fetch(
    `${apiBase()}/auth/nonce?address=${encodeURIComponent(address)}`,
    { method: 'GET', credentials: 'include' },
  );
  const data = await toJson(res);
  return {
    nonce: String(data.nonce ?? ''),
    message: String(data.message ?? data.nonce ?? ''),
    expiresAt: String(data.expiresAt ?? ''),
  };
}

export interface AuthTokens {
  token: string;
  expiresAt?: string;
  refreshToken?: string;
}

/** POST /api/v1/auth/verify — exchanges the signed challenge for a JWT. */
export async function verifyChallenge(input: {
  address: string;
  nonce: string;
  signature: string;
}): Promise<AuthTokens> {
  const res = await fetch(`${apiBase()}/auth/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await toJson(res);
  return {
    token: String(data.token ?? data.accessToken ?? ''),
    expiresAt: data.expiresAt ? String(data.expiresAt) : undefined,
    refreshToken: data.refreshToken ? String(data.refreshToken) : undefined,
  };
}

/**
 * POST /api/v1/auth/refresh — httpOnly cookie refresh.
 * The cookie travels automatically (`credentials: 'include'`); an in-memory
 * refresh token is sent as a fallback when the backend returns one in-body.
 * Returns null when the refresh is rejected (session must end).
 */
export async function refreshAccessToken(
  refreshToken?: string | null,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = (data as { token?: string; accessToken?: string }).token ??
      (data as { accessToken?: string }).accessToken;
    return token ?? null;
  } catch {
    return null;
  }
}

/** POST /api/v1/auth/logout — revokes the refresh token server-side. */
export async function revokeSession(refreshToken?: string | null): Promise<void> {
  try {
    await fetch(`${apiBase()}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshToken ?? '' }),
    });
  } catch {
    // Best effort — local session is cleared regardless.
  }
}
