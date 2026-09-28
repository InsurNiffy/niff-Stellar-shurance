/**
 * In-memory session store (#1507).
 *
 * The access token lives in a module-level variable only — it is NEVER
 * written to localStorage, sessionStorage, cookies or the DOM.
 * The refresh token is an httpOnly cookie owned by the backend; when the
 * backend hands one back in the verify/refresh payload we keep it here, in
 * memory only, so the cookie-less fallback path still works.
 */

export interface SessionSnapshot {
  /** In-memory JWT access token. */
  accessToken: string | null;
  /** In-memory refresh token (backend also sets an httpOnly cookie). */
  refreshToken: string | null;
  /** Wallet address the session is bound to. */
  address: string | null;
}

const EMPTY: SessionSnapshot = Object.freeze({
  accessToken: null,
  refreshToken: null,
  address: null,
});

let snapshot: SessionSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const sessionStore = {
  getSnapshot(): SessionSnapshot {
    return snapshot;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Establishes (or replaces) an authenticated session. */
  setSession(next: Partial<SessionSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    emit();
  },

  setAccessToken(accessToken: string | null): void {
    snapshot = { ...snapshot, accessToken };
    emit();
  },

  clear(): void {
    snapshot = EMPTY;
    emit();
  },
};

/** Milliseconds until a JWT expires (0 when missing/expired). */
export function msUntilExpiry(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 0;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as { exp?: number };
    if (!payload.exp) return 0;
    return Math.max(0, payload.exp * 1000 - Date.now());
  } catch {
    return 0;
  }
}
