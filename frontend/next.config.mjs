import bundleAnalyzer from '@next/bundle-analyzer'

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

// ---------------------------------------------------------------------------
// Content Security Policy
// ---------------------------------------------------------------------------
// Directive rationale:
//
// script-src
//   'self'          — our own JS bundles
//   'nonce-...'     — Next.js inline scripts (bootstrapper, __NEXT_DATA__)
//                     Nonce is injected per-request by middleware.ts.
//                     This eliminates the need for 'unsafe-inline'.
//   https://cdn.freighter.app          — Freighter wallet extension helper
//   https://xbull.app                  — xBull wallet connect script
//
// connect-src
//   'self'                             — same-origin API calls
//   NEXT_PUBLIC_API_URL                — backend REST/WS (set per environment)
//   https://soroban-testnet.stellar.org — Soroban RPC (testnet)
//   https://horizon-testnet.stellar.org — Horizon REST (testnet)
//   https://soroban.stellar.org        — Soroban RPC (mainnet)
//   https://horizon.stellar.org        — Horizon REST (mainnet)
//   https://stellar.expert             — block explorer links (fetch)
//   wss://soroban-testnet.stellar.org  — Soroban event streaming (testnet)
//   wss://soroban.stellar.org          — Soroban event streaming (mainnet)
//
// frame-src / frame-ancestors
//   Freighter and xBull open wallet popups as top-level windows, not iframes,
//   so frame-src 'none' is safe. frame-ancestors 'none' prevents clickjacking.
//
// Wallet vendor CSP guidance:
//   Freighter: https://docs.freighter.app/docs/guide/csp
//   xBull:     https://docs.xbull.app/integration/csp
//
// Report-only mode:
//   Set CSP_REPORT_ONLY=true in .env to switch to Content-Security-Policy-Report-Only.
//   Set CSP_REPORT_URI to your violation collector endpoint (e.g. Sentry, report-uri.com).
//   Iterate in report-only until violations are empty, then enforce.
// ---------------------------------------------------------------------------

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
// Normalise to origin only (strip path) so the directive stays tight.
const apiOrigin = apiUrl ? new URL(apiUrl).origin : ''

const reportUri = process.env.CSP_REPORT_URI ?? ''
const reportOnly = process.env.CSP_REPORT_ONLY === 'true'

/**
 * Build the CSP string. `nonce` is substituted at request time by middleware;
 * the static config uses the literal placeholder that Next.js replaces.
 */
function buildCsp(nonce) {
  const nonceDirective = nonce ? `'nonce-${nonce}'` : ''
  const reportDirective = reportUri ? `report-uri ${reportUri};` : ''

  const directives = [
    // Fallback for directives not explicitly listed
    `default-src 'self'`,

    // Scripts: self + nonce for Next.js inline bootstrapper; no unsafe-inline
    // Freighter and xBull inject via browser extension content scripts which
    // run outside the page CSP — no extra script-src entry needed for them.
    // Ref: https://docs.freighter.app/docs/guide/csp
    `script-src 'self' ${nonceDirective}`.trim(),

    // Styles: self + unsafe-inline required by Tailwind's runtime class injection.
    // Long-term: migrate to build-time CSS extraction to remove unsafe-inline.
    `style-src 'self' 'unsafe-inline'`,

    // Images: self + data URIs (used by Next/Image blur placeholders)
    `img-src 'self' data: blob:`,

    // Fonts: self only (Inter/IBM Plex Mono are self-hosted via next/font)
    `font-src 'self'`,

    // XHR/fetch/WebSocket — all RPC and API endpoints
    [
      `connect-src 'self'`,
      apiOrigin,
      // Soroban RPC + Horizon (testnet)
      'https://soroban-testnet.stellar.org',
      'https://horizon-testnet.stellar.org',
      'wss://soroban-testnet.stellar.org',
      // Soroban RPC + Horizon (mainnet)
      'https://soroban.stellar.org',
      'https://horizon.stellar.org',
      'wss://soroban.stellar.org',
      // Block explorer (used by explorerUrl() in vote.ts / policy.ts)
      'https://stellar.expert',
    ]
      .filter(Boolean)
      .join(' '),

    // No iframes needed; wallet popups are top-level windows
    `frame-src 'none'`,

    // Prevent this app from being embedded in foreign frames (clickjacking)
    `frame-ancestors 'none'`,

    // Disallow plugins (Flash etc.)
    `object-src 'none'`,

    // Restrict base tag hijacking
    `base-uri 'self'`,

    // Restrict form targets
    `form-action 'self'`,

    reportDirective,
  ]
    .filter(Boolean)
    .join('; ')

  return directives
}

const CSP_HEADER = reportOnly
  ? 'Content-Security-Policy-Report-Only'
  : 'Content-Security-Policy'

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    minimumCacheTTL: 60,
    domains: ['localhost'],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  poweredByHeader: false,
  reactStrictMode: true,

  async headers() {
    return [
      {
        // Apply security headers to all routes.
        // The CSP nonce placeholder is replaced per-request by middleware.ts;
        // this static header acts as a fallback for static export / CDN edge
        // cases where middleware does not run.
        source: '/(.*)',
        headers: [
          {
            key: CSP_HEADER,
            // No nonce in the static fallback — middleware provides the real one.
            value: buildCsp(''),
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default withBundleAnalyzer(nextConfig)
