import { renderEnvExample } from './env.definitions';
import { validateEnvironment } from './env.validation';

function validEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL:
      'postgresql://niffy_app:replace-me@localhost:5432/niffyinsure?schema=public',
    REDIS_URL: 'redis://localhost:6379/0',
    STELLAR_NETWORK: 'testnet',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    JWT_SECRET: 'a'.repeat(64),
    ADMIN_TOKEN: 'b'.repeat(32),
    FRONTEND_ORIGINS: 'http://localhost:3001',
    CAPTCHA_SECRET_KEY: 'dev-skip',
    IP_HASH_SALT: '0123456789abcdef0123456789abcdef',
    ...overrides,
  };
}

describe('validateEnvironment', () => {
  it('fails fast with clear missing-key messages', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('requires pinata credentials when pinata is enabled', () => {
    expect(() =>
      validateEnvironment(
        validEnv({
          IPFS_PROVIDER: 'pinata',
          PINATA_API_KEY: '',
          PINATA_API_SECRET: '',
        }),
      ),
    ).toThrow(/PINATA_API_KEY/);
  });

  it('rejects production placeholder secrets', () => {
    expect(() =>
      validateEnvironment(
        validEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'replace-with-64-byte-base64url-key',
        }),
      ),
    ).toThrow(/JWT_SECRET/);
  });
});

describe('renderEnvExample', () => {
  it('documents required and optional keys from the shared manifest', () => {
    const output = renderEnvExample();
    expect(output).toContain('JWT_SECRET=replace-with-64-byte-base64url-key');
    expect(output).toContain('# [required] HMAC signing secret for user/admin JWTs.');
    expect(output).toContain('PINATA_API_KEY=');
  });
});
