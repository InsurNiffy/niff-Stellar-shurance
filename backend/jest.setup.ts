/**
 * Jest global setup — stubs required environment variables so unit tests
 * can import modules that call getRuntimeEnv() at module load time without
 * triggering the Joi validation error.
 *
 * Integration / E2E tests that need real services should override these
 * in their own beforeAll() or use the global-setup.ts testcontainers setup.
 */

// Minimal set of env vars required by env.validation.ts
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
process.env.SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
process.env.HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
process.env.STELLAR_NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';
process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? 'testnet';
process.env.CONTRACT_ID = process.env.CONTRACT_ID ?? 'CTEST000000000000000000000000000000000000000000000000000001';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-at-least-32-characters-long!!';
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'test-admin-token-at-least-24-chars!!';
process.env.FRONTEND_ORIGINS = process.env.FRONTEND_ORIGINS ?? 'http://localhost:3001';
process.env.API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
process.env.ADMIN_CORS_ORIGINS = process.env.ADMIN_CORS_ORIGINS ?? '';
process.env.CAPTCHA_SECRET_KEY = process.env.CAPTCHA_SECRET_KEY ?? 'dev-skip';
process.env.IP_HASH_SALT = process.env.IP_HASH_SALT ?? 'test-ip-hash-salt-32-chars-minimum!!';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.PORT = process.env.PORT ?? '3000';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
process.env.AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? 'localhost';
process.env.NONCE_TTL_SECONDS = process.env.NONCE_TTL_SECONDS ?? '300';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
process.env.JWT_ISSUER = process.env.JWT_ISSUER ?? 'niffyinsure';
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? 'niffyinsure-api';
process.env.SMTP_HOST = process.env.SMTP_HOST ?? 'localhost';
process.env.SMTP_PORT = process.env.SMTP_PORT ?? '1025';
process.env.SMTP_USER = process.env.SMTP_USER ?? '';
process.env.SMTP_PASS = process.env.SMTP_PASS ?? '';
process.env.SMTP_FROM = process.env.SMTP_FROM ?? 'noreply@niffyinsure.com';
process.env.SOLVENCY_CRON_EXPRESSION = process.env.SOLVENCY_CRON_EXPRESSION ?? '0 * * * *';
process.env.RENEWAL_REMINDER_CRON = process.env.RENEWAL_REMINDER_CRON ?? '0 * * * *';
process.env.DISABLE_REINDEX_WORKER = process.env.DISABLE_REINDEX_WORKER ?? '1';
