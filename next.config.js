/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== 'production';

// Known endpoints allowed for connect-src: API, IPFS gateways, and Stellar RPC.
const API_ENDPOINTS = [
  "'self'",
  'https://api.stellar.org',
  'https://horizon.stellar.org',
  'https://soroban-testnet.stellar.org',
  'https://soroban-mainnet.stellar.org',
];

const IPFS_GATEWAYS = [
  'https://ipfs.io',
  'https://cloudflare-ipfs.com',
  'https://gateway.pinata.cloud',
  'https://dweb.link',
];

const STELLAR_RPC = [
  'https://rpc.stellar.org',
  'https://soroban-testnet.stellar.org',
  'https://soroban-mainnet.stellar.org',
];

const connectSrc = Array.from(
  new Set([...API_ENDPOINTS, ...IPFS_GATEWAYS, ...STELLAR_RPC]),
);

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // No 'unsafe-eval' or 'unsafe-inline' in production script-src.
      isDev
        ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
        : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src ${connectSrc.join(' ')}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "require-trusted-types-for 'script'",
      'trusted-types default',
      'upgrade-insecure-requests',
    ].join('; '),
  },
  {
    key: 'Report-To',
    value: JSON.stringify({
      group: 'csp-endpoint',
      max_age: 10886400,
      endpoints: [{ url: 'https://security.stellar.org/csp-report' }],
    }),
  },
  {
    key: 'Reporting-Endpoints',
    value: 'csp-endpoint="https://security.stellar.org/csp-report"',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
