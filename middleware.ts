import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SECURITY_REPORT_ENDPOINT = '/api/security/csp-report';

function buildCsp(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://ipfs.io', 'https://*.ipfs.io', 'https://*.mypinata.cloud'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      'https://api.stellar.org',
      'https://horizon.stellar.org',
      'https://soroban-testnet.stellar.org',
      'https://soroban-mainnet.stellar.org',
      'https://ipfs.io',
      'https://*.ipfs.io',
      'https://*.mypinata.cloud',
    ],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'require-trusted-types-for': ["'script'"],
    'trusted-types': ["default"],
    'report-to': ['csp-endpoint'],
    'report-uri': [SECURITY_REPORT_ENDPOINT],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

const CSP_HEADER = buildCsp();

const REPORT_TO_HEADER = JSON.stringify({
  group: 'csp-endpoint',
  max_age: 10886400,
  endpoints: [{ url: SECURITY_REPORT_ENDPOINT }],
});

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set('Content-Security-Policy', CSP_HEADER);
  response.headers.set('Report-To', REPORT_TO_HEADER);

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
