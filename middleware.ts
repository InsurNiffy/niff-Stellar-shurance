import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SECURITY_REPORT_ENDPOINT = '/api/security/csp-report';

const SUPPORTED_LOCALES = ['en', 'es'] as const;
const DEFAULT_LOCALE = 'en';
const LOCALE_COOKIE = 'NEXT_LOCALE';

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

function isSupportedLocale(value: string | undefined | null): value is (typeof SUPPORTED_LOCALES)[number] {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function detectLocale(request: NextRequest): string {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isSupportedLocale(cookieLocale)) {
    return cookieLocale;
  }

  const acceptLanguage = request.headers.get('accept-language');
  if (acceptLanguage) {
    const preferred = acceptLanguage
      .split(',')
      .map((part) => part.split(';')[0]?.trim().toLowerCase())
      .filter(Boolean);

    for (const tag of preferred) {
      const base = tag.split('-')[0];
      if (isSupportedLocale(base)) {
        return base;
      }
    }
  }

  return DEFAULT_LOCALE;
}

function getPathnameLocale(pathname: string): string | undefined {
  const segment = pathname.split('/')[1];
  return isSupportedLocale(segment) ? segment : undefined;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const pathnameLocale = getPathnameLocale(pathname);

  if (!pathnameLocale) {
    const locale = detectLocale(request);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    redirectUrl.search = search;

    const redirectResponse = NextResponse.redirect(redirectUrl);
    redirectResponse.cookies.set(LOCALE_COOKIE, locale, { path: '/', sameSite: 'lax' });
    return redirectResponse;
  }

  const response = NextResponse.next();

  response.headers.set('Content-Security-Policy', CSP_HEADER);
  response.headers.set('Report-To', REPORT_TO_HEADER);
  response.cookies.set(LOCALE_COOKIE, pathnameLocale, { path: '/', sameSite: 'lax' });

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
