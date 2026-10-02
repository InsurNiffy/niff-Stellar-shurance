import { parseEnv } from './env.schema';

const BASE = {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'supersecretkey',
};

describe('parseEnv', () => {
  it('accepts a minimal valid config', () => {
    const env = parseEnv(BASE);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.STELLAR_NETWORK).toBe('testnet');
  });

  it('coerces PORT from string', () => {
    const env = parseEnv({ ...BASE, PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...rest } = BASE;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _, ...rest } = BASE;
    expect(() => parseEnv(rest)).toThrow(/JWT_SECRET/);
  });

  it('accepts testnet network profile without contract ids', () => {
    const env = parseEnv({ ...BASE, STELLAR_NETWORK: 'testnet' });
    expect(env.STELLAR_NETWORK).toBe('testnet');
  });

  it('rejects mainnet when CONTRACT_ID is absent', () => {
    expect(() =>
      parseEnv({ ...BASE, STELLAR_NETWORK: 'mainnet', SOROBAN_RPC_URL: 'https://rpc.example.com', HORIZON_URL: 'https://h.example.com' }),
    ).toThrow(/CONTRACT_ID/);
  });

  it('accepts mainnet when all required fields are present', () => {
    const env = parseEnv({
      ...BASE,
      STELLAR_NETWORK: 'mainnet',
      SOROBAN_RPC_URL: 'https://rpc.example.com',
      HORIZON_URL: 'https://h.example.com',
      CONTRACT_ID: 'CABCDE',
      DEFAULT_TOKEN_CONTRACT_ID: 'CXYZ',
    });
    expect(env.STELLAR_NETWORK).toBe('mainnet');
  });
});
