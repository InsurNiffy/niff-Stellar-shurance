export type CookieConsentValue = 'accepted' | 'declined'

export const COOKIE_CONSENT_KEY = 'niffyinsur:cookie-consent'
export const COOKIE_CONSENT_EVENT = 'cookie-consent-changed'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CONSENT_TTL_MS = 365 * ONE_DAY_MS

interface StoredConsent {
  value: CookieConsentValue
  expiresAt: number
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
  }

  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(payload))
    window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT))
  } catch {
    // ignore storage write errors
  }
}
