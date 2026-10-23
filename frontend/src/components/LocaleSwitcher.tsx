'use client'

import { useLocale } from 'next-intl'
import { useEffect, useRef, useState, useTransition } from 'react'

import { routing } from '@/i18n/routing'
import { usePathname, useRouter } from '@/i18n/navigation'

const LABELS: Record<string, string> = { en: 'English', es: 'Español' }

// Cookie name used by next-intl middleware to persist locale preference.
// Must match the cookieName in routing config (defaults to NEXT_LOCALE).
const LOCALE_COOKIE = 'NEXT_LOCALE'

// localStorage key for locale preference (supplements the middleware cookie).
const LOCALE_STORAGE_KEY = 'niffyinsur:locale'

/**
 * Locale switcher dropdown.
 *
 * Behaviour:
 *   - Renders a styled <select> listing all locales from routing config.
 *   - Navigates to the same path under the selected locale prefix.
 *   - Persists the selection in both a cookie (for next-intl middleware) and
 *     localStorage (so the preference survives cookie clearing in the same
 *     browser session).
 *   - Announces the locale change via a visually-hidden aria-live region so
 *     screen-reader users hear confirmation without having to move focus.
 */
export function LocaleSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [announcement, setAnnouncement] = useState('')
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // On mount, apply any localStorage preference that wasn't picked up by the
  // middleware (e.g. after the user cleared cookies between sessions).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored && stored !== locale && routing.locales.includes(stored as (typeof routing.locales)[number])) {
      // Silently navigate to the stored locale without re-announcing
      startTransition(() => {
        router.replace(pathname, { locale: stored })
      })
    }
    // Only run on mount; intentionally not reactive to `locale` changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = e.target.value
    const label = LABELS[nextLocale] ?? nextLocale.toUpperCase()

    // Persist in cookie so middleware can read it on the next server request
    // and avoid a redirect loop on page reload.
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`

    // Persist in localStorage as a durable fallback
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
    } catch {
      // Ignore storage errors (e.g. private-browsing quota)
    }

    // Announce the change to screen readers before the navigation fires
    if (announcementTimer.current) clearTimeout(announcementTimer.current)
    setAnnouncement(`Language changed to ${label}`)
    announcementTimer.current = setTimeout(() => setAnnouncement(''), 3000)

    startTransition(() => {
      router.replace(pathname, { locale: nextLocale })
    })
  }

  return (
    <>
      {/* Visible dropdown */}
      <select
        value={locale}
        onChange={onChange}
        disabled={isPending}
        aria-label="Select language"
        aria-busy={isPending}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LABELS[l] ?? l.toUpperCase()}
          </option>
        ))}
      </select>

      {/* Visually-hidden live region for screen-reader announcements */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>
    </>
  )
}
