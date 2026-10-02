import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from './env.schema';

/**
 * Typed wrapper around ConfigService.
 * All code must use this service instead of calling process.env directly.
 * An ESLint no-restricted-properties rule in eslint.config.mjs enforces this.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  get<K extends keyof AppEnv>(key: K): AppEnv[K] {
    return this.config.get(key as string) as AppEnv[K];
  }

  get nodeEnv() { return this.get('NODE_ENV'); }
  get port() { return this.get('PORT'); }
  get databaseUrl() { return this.get('DATABASE_URL'); }
  get redisUrl() { return this.get('REDIS_URL'); }
  get stellarNetwork() { return this.get('STELLAR_NETWORK'); }
  get sorobanRpcUrl() { return this.get('SOROBAN_RPC_URL'); }
  get horizonUrl() { return this.get('HORIZON_URL'); }
  get networkPassphrase() { return this.get('STELLAR_NETWORK_PASSPHRASE'); }
  get contractId() { return this.get('CONTRACT_ID'); }
  get jwtSecret() { return this.get('JWT_SECRET'); }
  get jwtExpiresIn() { return this.get('JWT_EXPIRES_IN'); }
  get jwtRefreshExpiresIn() { return this.get('JWT_REFRESH_EXPIRES_IN'); }
  get jwtIssuer() { return this.get('JWT_ISSUER'); }
  get jwtAudience() { return this.get('JWT_AUDIENCE'); }
  get authDomain() { return this.get('AUTH_DOMAIN'); }
  get nonceTtlSeconds() { return this.get('NONCE_TTL_SECONDS'); }
  get logLevel() { return this.get('LOG_LEVEL'); }
  get ipfsProvider() { return this.get('IPFS_PROVIDER'); }
  get simulateTimeoutMs() { return this.get('SOROBAN_SIMULATE_TIMEOUT_MS'); }
}
