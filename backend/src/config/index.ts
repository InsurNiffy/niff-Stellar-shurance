import { getRuntimeEnv } from './runtime-env';

export interface AppConfig {
  port: number;
  env: 'development' | 'production' | 'test';
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
  };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  };
  security: {
    corsOrigins: string[];
  };
  logging: {
    logLevel: 'error' | 'warn' | 'log' | 'verbose' | 'debug';
  };
}

function parseDatabaseUrl(databaseUrl: string): AppConfig['database'] {
  const url = new URL(databaseUrl);

  return {
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    name: url.pathname.replace(/^\//, ''),
  };
}

export function getConfig(): AppConfig {
  const env = getRuntimeEnv();

  return {
    port: env.PORT,
    env: env.NODE_ENV,
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
    database: parseDatabaseUrl(env.DATABASE_URL),
    security: {
      corsOrigins: env.FRONTEND_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
    logging: {
      logLevel: env.LOG_LEVEL,
    },
  };
}

export function validateProductionConfig(config: AppConfig): void {
  if (config.env !== 'production') {
    return;
  }

  const missing: string[] = [];

  if (!config.jwt.secret) {
    missing.push('JWT_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for ${config.env}: ${missing.join(', ')}`,
    );
  }
}

export const config = getConfig();
export default config;
