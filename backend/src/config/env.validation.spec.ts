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
    API_BASE_URL: 'http://localhost:3000',
    ...overrides,
  };
}

describe('validateEnvironment', () => {
  it('accepts a fully valid config', () => {
    const env = validEnv();
    const result = validateEnvironment(env);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.DATABASE_URL).toContain('postgresql');
    expect(result.REDIS_URL).toContain('redis');
  });

  it('fails fast with clear missing-key messages', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('reports multiple missing required keys in one error', () => {
    const fn = () =>
      validateEnvironment({
        NODE_ENV: 'development',
      });

    expect(fn).toThrow();
    try {
      fn();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/DATABASE_URL|REDIS_URL|SOROBAN_RPC_URL/i);
    }
  });

  it('rejects wrong-typed values with clear error', () => {
    expect(() =>
      validateEnvironment(
        validEnv({
          PORT: 'not-a-number',
        }),
      ),
    ).toThrow(/PORT/);
  });

  it('rejects invalid enum values', () => {
    expect(() =>
      validateEnvironment(
        validEnv({
          NODE_ENV: 'invalid-env',
        }),
      ),
    ).toThrow(/NODE_ENV/);
  });

  it('rejects invalid database URL scheme', () => {
    expect(() =>
      validateEnvironment(
        validEnv({
          DATABASE_URL: 'mysql://localhost/db',
        }),
      ),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects invalid Redis URL scheme', () => {
    expect(() =>
      validateEnvironment(
        validEnv({
          REDIS_URL: 'mysql://localhost/0',
        }),
      ),
    ).toThrow(/REDIS_URL/);
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

  it('rejects production with short admin token', () => {
    expect(() =>
      validateEnvironment(
        validEnv({
          NODE_ENV: 'production',
          ADMIN_TOKEN: 'tooshort',
        }),
      ),
    ).toThrow(/ADMIN_TOKEN/);
  });

  it('accepts development with minimal placeholders', () => {
    const result = validateEnvironment(
      validEnv({
        NODE_ENV: 'development',
      }),
    );
    expect(result.NODE_ENV).toBe('development');
  });

  it('allows unknown keys without error', () => {
    const result = validateEnvironment(
      validEnv({
        CUSTOM_UNKNOWN_VAR: 'allowed',
      }),
    );
    expect(result.NODE_ENV).toBe('development');
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
