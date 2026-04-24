import { PersistedQueryMiddleware } from './persisted-query.middleware';

describe('PersistedQueryMiddleware', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const config = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'GRAPHQL_PERSISTED_QUERIES_ENABLED') return true;
      if (key === 'GRAPHQL_PERSISTED_QUERY_TTL_SECONDS') return 60;
      return defaultValue;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores queries when a valid hash is supplied', async () => {
    const middleware = new PersistedQueryMiddleware(redis as never, config as never);
    const req = {
      body: {
        query: 'query Test { viewer { authenticated } }',
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: '897430f5888d37fefdc9d48d0a47b87072d1eb1e688c0728d45c43e211a04371',
          },
        },
      },
    };
    const res = { status: jest.fn(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(req as never, res as never, next);

    expect(redis.set).toHaveBeenCalledWith(
      'graphql:apq:897430f5888d37fefdc9d48d0a47b87072d1eb1e688c0728d45c43e211a04371',
      'query Test { viewer { authenticated } }',
      60,
    );
    expect(next).toHaveBeenCalled();
  });

  it('hydrates a stored query when the client sends only the hash', async () => {
    redis.get.mockResolvedValue('query Test { viewer { authenticated } }');
    const middleware = new PersistedQueryMiddleware(redis as never, config as never);
    const req: { body: { query?: string; extensions: { persistedQuery: { version: number; sha256Hash: string } } } } = {
      body: {
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'stored-hash',
          },
        },
      },
    };
    const res = { status: jest.fn(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(req as never, res as never, next);

    expect(req.body.query).toBe('query Test { viewer { authenticated } }');
    expect(next).toHaveBeenCalled();
  });
});
