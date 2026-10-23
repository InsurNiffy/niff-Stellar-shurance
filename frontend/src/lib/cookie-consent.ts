export type CookieConsentValue = 'accepted' | 'declined'

export const COOKIE_CONSENT_KEY = 'niffyinsur:cookie-consent'
export const COOKIE_CONSENT_EVENT = 'cookie-consent-changed'

/**
 * Bump this version when the consent scope changes in a way that requires
 * users to re-consent (e.g. adding a new data-processing category).
 * Stored alongside the consent value; mismatches force the banner to re-appear.
 */
export const COOKIE_CONSENT_VERSION = 1

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CONSENT_TTL_MS = 365 * ONE_DAY_MS

interface StoredConsent {
  value: CookieConsentValue
  expiresAt: number
  /** Schema version — if missing or outdated the consent is treated as unset. */
  version?: number
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

export function getCookieConsent(): StoredConsent | null {
  if (!isBrowser()) return null

  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as StoredConsent
    if (!parsed?.value || !parsed.expiresAt) {
      localStorage.removeItem(COOKIE_CONSENT_KEY)
      return null
    }

    if (parsed.value !== 'accepted' && parsed.value !== 'declined') {
      localStorage.removeItem(COOKIE_CONSENT_KEY)
      return null
    }

    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(COOKIE_CONSENT_KEY)
      return null
    }

    // Treat consent from an older schema version as unset so users re-consent
    if ((parsed.version ?? 0) < COOKIE_CONSENT_VERSION) {
      localStorage.removeItem(COOKIE_CONSENT_KEY)
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function setCookieConsent(value: CookieConsentValue): void {
  if (!isBrowser()) return

  const payload: StoredConsent = {
    value,
    expiresAt: Date.now() + CONSENT_TTL_MS,
    version: COOKIE_CONSENT_VERSION,
  }

  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(payload))
    window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT))
  } catch {
    // ignore storage write errors
  }
}

export function getConsent(): CookieConsentValue | null {
  return getCookieConsent()?.value ?? null
}

export function setConsent(value: CookieConsentValue): void {
  setCookieConsent(value)
}
