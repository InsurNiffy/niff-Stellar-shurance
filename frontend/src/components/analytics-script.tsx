'use client'

/**
 * AnalyticsScript — injects the Plausible script only when analytics is
 * configured and the user has accepted analytics consent.
 *
 * Rendered from the root layout. The nonce from the CSP middleware is forwarded
 * so the script satisfies the nonce-based policy.
 *
 * Environment variables:
 *   NEXT_PUBLIC_ANALYTICS_ENABLED  — set to "true" in staging/production
 *   NEXT_PUBLIC_ANALYTICS_DOMAIN   — your Plausible site domain, e.g. "niffyinsur.com"
 *   NEXT_PUBLIC_ANALYTICS_SRC      — optional self-hosted Plausible URL
 *                                    defaults to "https://plausible.io/js/script.js"
 *
 * CSP: the Plausible script origin must be added to script-src and
 * connect-src in middleware.ts when using the cloud-hosted version.
 */

import { useEffect, useState } from 'react'
import Script from 'next/script'

import { COOKIE_CONSENT_EVENT, getCookieConsent } from '@/lib/cookie-consent'

interface AnalyticsScriptProps {
  nonce?: string
}

const ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true'
const DOMAIN = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN ?? ''
const SRC =
  process.env.NEXT_PUBLIC_ANALYTICS_SRC ??
  'https://plausible.io/js/script.js'

export function AnalyticsScript({ nonce }: AnalyticsScriptProps) {
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (!ENABLED || !DOMAIN) return

    const update = () => {
      const consent = getCookieConsent()
      setAllowed(consent?.value === 'accepted')
    }

    update()
    window.addEventListener('storage', update)
    window.addEventListener(COOKIE_CONSENT_EVENT, update)

    return () => {
      window.removeEventListener('storage', update)
      window.removeEventListener(COOKIE_CONSENT_EVENT, update)
    }
  }, [])

  // Disabled in local dev (env var absent) or when domain is not configured
  if (!ENABLED || !DOMAIN || !allowed) return null

  return (
    <Script
      strategy="afterInteractive"
      data-domain={DOMAIN}
      src={SRC}
      nonce={nonce}
    />
  )
}
