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
  };
}

const env = getRuntimeEnv();

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
  },
};

export default config;
