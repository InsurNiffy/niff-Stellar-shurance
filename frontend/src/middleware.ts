import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Per-request nonce injection for Content Security Policy
//
// Why middleware and not next.config headers()?
// next.config headers() are static — they cannot embed a per-request nonce.
// Middleware runs on every request at the edge, generates a fresh nonce, and
// sets both the CSP header and a request header that the layout can read to
// inject the nonce into <script> tags (required for Next.js inline scripts).
//
// Nonce flow:
//   1. Middleware generates crypto nonce → sets response header CSP with nonce
//   2. Middleware forwards nonce in x-nonce request header
//   3. layout.tsx reads x-nonce via headers() and passes it to <Script nonce>
//
// See: https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
// ---------------------------------------------------------------------------

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL
  ? (() => { try { return new URL(process.env.NEXT_PUBLIC_API_URL).origin } catch { return '' } })()
  : ''

const REPORT_URI = process.env.CSP_REPORT_URI ?? ''
const REPORT_ONLY = process.env.CSP_REPORT_ONLY === 'true'
const CSP_HEADER = REPORT_ONLY
  ? 'Content-Security-Policy-Report-Only'
  : 'Content-Security-Policy'

function buildCsp(nonce: string): string {
  const reportDirective = REPORT_URI ? `report-uri ${REPORT_URI}` : ''

  return [
    `default-src 'self'`,
    // Nonce covers Next.js inline bootstrapper (__NEXT_DATA__, chunk loader).
    // No unsafe-inline needed when a nonce is present.
    `script-src 'self' 'nonce-${nonce}'`,
    // Tailwind injects styles at runtime; unsafe-inline required until
    // build-time CSS extraction is adopted. Track in: TODO(csp-style-nonce).
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    // Fonts are self-hosted via next/font (Inter, IBM Plex Mono)
    `font-src 'self'`,
    [
      `connect-src 'self'`,
      API_ORIGIN,
      // Soroban RPC + Horizon — testnet
      // Ref: https://developers.stellar.org/network/soroban-rpc
      'https://soroban-testnet.stellar.org',
      'https://horizon-testnet.stellar.org',
      'wss://soroban-testnet.stellar.org',
      // Soroban RPC + Horizon — mainnet
      'https://soroban.stellar.org',
      'https://horizon.stellar.org',
      'wss://soroban.stellar.org',
      // Block explorer used by explorerUrl() helpers
      'https://stellar.expert',
    ]
      .filter(Boolean)
      .join(' '),
    // Wallet popups (Freighter, xBull) open as top-level windows, not iframes.
    // Ref: https://docs.freighter.app/docs/guide/csp
    // Ref: https://docs.xbull.app/integration/csp
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    reportDirective,
  ]
    .filter(Boolean)
    .join('; ')
}

export function middleware(request: NextRequest): NextResponse {
  // crypto.randomUUID() is available in the Edge runtime
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(request.headers),
        // Forward nonce to the layout so it can be placed on <Script> tags
        'x-nonce': nonce,
      }),
    },
  })

  response.headers.set(CSP_HEADER, buildCsp(nonce))
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  return response
}

export const config = {
  matcher: [
    // Apply to all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|site.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)).*)',
  ],
}
