/**
 * Application configuration
 */
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
  bcrypt: {
    saltRounds: number;
  };
  security: {
    corsOrigins: string[];
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
    tokenExpiryHours: number;
    refreshTokenExpiryDays: number;
  };
  logging: {
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    logAuthFailures: boolean;
  };
}

/**
 * Get configuration from environment variables
 */
export function getConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    env: (process.env.NODE_ENV as AppConfig['env']) || 'development',
    jwt: {
      secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
      expiresIn: process.env.JWT_EXPIRES_IN || '1h',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      issuer: process.env.JWT_ISSUER || 'niffyinsure',
      audience: process.env.JWT_AUDIENCE || 'niffyinsure-api',
    },
    bcrypt: {
      saltRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    },
    security: {
      corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),
      rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
      rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      tokenExpiryHours: parseInt(process.env.TOKEN_EXPIRY_HOURS || '1', 10),
      refreshTokenExpiryDays: parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '7', 10),
    },
    logging: {
      logLevel: (process.env.LOG_LEVEL as AppConfig['logging']['logLevel']) || 'info',
      logAuthFailures: process.env.LOG_AUTH_FAILURES !== 'false',
    },
  };
}

/**
 * Validate required production configurations
 */
export function validateProductionConfig(config: AppConfig): void {
  const requiredVars: string[] = [];
  
  if (config.env === 'production') {
    if (config.jwt.secret === 'dev-secret-change-in-production') {
      requiredVars.push('JWT_SECRET');
    }
  }
  
  if (requiredVars.length > 0) {
    throw new Error(`Missing required environment variables for ${config.env} environment: ${requiredVars.join(', ')}`);
  }
}

export const config = getConfig();
export default config;