import { getRuntimeEnv } from './runtime-env';

export interface EnvConfig {
  auth: {
    domain: string;
    nonceTtlSeconds: number;
  };
  jwt: {
    secret: string;
    ttl: string;
    issuer: string;
    audience: string;
  };
  redis: {
    url: string;
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  stellar: {
    rpcUrl: string;
    networkPassphrase: string;
    contractId: string;
    simulationTimeoutMs: number;
  };
  security: {
    corsOrigins: string[];
    cspConnectSrc: string[];
    cspImgSrc: string[];
    cspScriptSrc: string[];
    hstsMaxAgeSeconds: number;
    hstsIncludeSubDomains: boolean;
    hstsPreload: boolean;
  };
}

const env = getRuntimeEnv();

const DEFAULT_SOROBAN_SIMULATION_TIMEOUT_MS = 5000;
const DEFAULT_HSTS_MAX_AGE_SECONDS = 31536000;

const DEFAULT_CSP_SCRIPT_SRC = ["'self'", 'https://cdn.jsdelivr.net'];
const DEFAULT_CSP_CONNECT_SRC = [
  "'self'",
  'https://horizon.stellar.org',
  'https://soroban-testnet.stellar.org',
  'https://ipfs.io',
  'https://cloudflare-ipfs.com',
  'https://gateway.pinata.cloud',
];
const DEFAULT_CSP_IMG_SRC = [
  "'self'",
  'data:',
  'https://ipfs.io',
  'https://cloudflare-ipfs.com',
  'https://gateway.pinata.cloud',
];

function resolveSimulationTimeoutMs(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SOROBAN_SIMULATION_TIMEOUT_MS;
  }
  return parsed;
}

function parseList(value: unknown, fallback: string[]): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  return fallback;
}

function resolveHstsMaxAge(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_HSTS_MAX_AGE_SECONDS;
  }
  return parsed;
}

export const config: EnvConfig = {
  auth: {
    domain: env.AUTH_DOMAIN,
    nonceTtlSeconds: env.NONCE_TTL_SECONDS,
  },
  jwt: {
    secret: env.JWT_SECRET,
    ttl: env.JWT_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  },
  redis: {
    url: env.REDIS_URL,
  },
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  },
  stellar: {
    rpcUrl: env.SOROBAN_RPC_URL,
    networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
    contractId: env.CONTRACT_ID,
    simulationTimeoutMs: resolveSimulationTimeoutMs(
      (env as Record<string, unknown>).SOROBAN_SIMULATION_TIMEOUT_MS,
    ),
  },
  security: {
    corsOrigins: parseList((env as Record<string, unknown>).CORS_ALLOWED_ORIGINS, []),
    cspScriptSrc: parseList(
      (env as Record<string, unknown>).CSP_SCRIPT_SRC,
      DEFAULT_CSP_SCRIPT_SRC,
    ),
    cspConnectSrc: parseList(
      (env as Record<string, unknown>).CSP_CONNECT_SRC,
      DEFAULT_CSP_CONNECT_SRC,
    ),
    cspImgSrc: parseList((env as Record<string, unknown>).CSP_IMG_SRC, DEFAULT_CSP_IMG_SRC),
    hstsMaxAgeSeconds: resolveHstsMaxAge(
      (env as Record<string, unknown>).HSTS_MAX_AGE_SECONDS,
    ),
    hstsIncludeSubDomains: parseBoolean(
      (env as Record<string, unknown>).HSTS_INCLUDE_SUBDOMAINS,
      true,
    ),
    hstsPreload: parseBoolean((env as Record<string, unknown>).HSTS_PRELOAD, false),
  },
};

export default config;
