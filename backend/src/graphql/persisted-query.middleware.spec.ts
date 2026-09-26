import { PersistedQueryMiddleware } from './persisted-query.middleware';

const KNOWN_QUERY = 'query Test { viewer { authenticated } }';
const KNOWN_HASH = '897430f5888d37fefdc9d48d0a47b87072d1eb1e688c0728d45c43e211a04371';

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
        query: KNOWN_QUERY,
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: KNOWN_HASH,
          },
        },
      },
    };
    const res = { status: jest.fn(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(req as never, res as never, next);

    expect(redis.set).toHaveBeenCalledWith(
      `graphql:apq:${KNOWN_HASH}`,
      KNOWN_QUERY,
      60,
    );
    expect(next).toHaveBeenCalled();
  });

  it('hydrates a stored query when the client sends only the hash', async () => {
    redis.get.mockResolvedValue(KNOWN_QUERY);
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

    expect(req.body.query).toBe(KNOWN_QUERY);
    expect(next).toHaveBeenCalled();
  });
});

describe('PersistedQueryMiddleware — production mode (GRAPHQL_PERSISTED_QUERIES_ONLY=true)', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
  };

  function makeConfig(allowlistHashes: string[] = [], allowlistBodies: Record<string, string> = {}) {
    return {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'GRAPHQL_PERSISTED_QUERIES_ONLY') return true;
        if (key === 'GRAPHQL_PERSISTED_QUERIES_ENABLED') return true;
        if (key === 'GRAPHQL_PERSISTED_QUERY_ALLOWLIST') return allowlistHashes.join(',');
        if (key === 'GRAPHQL_PERSISTED_QUERY_TTL_SECONDS') return 60;
        return defaultValue;
      }),
      _allowlistBodies: allowlistBodies,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress file-not-found errors during tests (no JSON file on disk).
  });

  it('rejects an unknown hash with PersistedQueryNotFound', async () => {
    const config = makeConfig([]);
    const middleware = new PersistedQueryMiddleware(redis as never, config as never);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(
      { body: { extensions: { persistedQuery: { version: 1, sha256Hash: 'deadbeef' } } } } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({
            message: 'PersistedQueryNotFound',
            extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' },
          }),
        ]),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a request with no hash with PersistedQueryNotFound', async () => {
    const config = makeConfig([]);
    const middleware = new PersistedQueryMiddleware(redis as never, config as never);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(
      { body: { query: 'query { viewer { authenticated } }' } } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }),
        ]),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('executes an allowlisted query (hash + body)', async () => {
    redis.set.mockResolvedValue('OK');
    const config = makeConfig([KNOWN_HASH]);
    const middleware = new PersistedQueryMiddleware(redis as never, config as never);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(
      {
        body: {
          query: KNOWN_QUERY,
          extensions: { persistedQuery: { version: 1, sha256Hash: KNOWN_HASH } },
        },
      } as never,
      res as never,
      next,
    );

    expect(redis.set).toHaveBeenCalledWith(`graphql:apq:${KNOWN_HASH}`, KNOWN_QUERY, 60);
    expect(next).toHaveBeenCalled();
  });

  it('hydrates an allowlisted query from Redis (hash-only request)', async () => {
    redis.get.mockResolvedValue(KNOWN_QUERY);
    const config = makeConfig([KNOWN_HASH]);
    const middleware = new PersistedQueryMiddleware(redis as never, config as never);
    const req = {
      body: { extensions: { persistedQuery: { version: 1, sha256Hash: KNOWN_HASH } } },
    } as { body: { query?: string; extensions: { persistedQuery: { version: number; sha256Hash: string } } } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(req as never, res as never, next);

    expect(req.body.query).toBe(KNOWN_QUERY);
    expect(next).toHaveBeenCalled();
  });
});

describe('PersistedQueryMiddleware — development mode (GRAPHQL_PERSISTED_QUERIES_ONLY=false)', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const devConfig = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'GRAPHQL_PERSISTED_QUERIES_ONLY') return false;
      if (key === 'GRAPHQL_PERSISTED_QUERIES_ENABLED') return false;
      if (key === 'GRAPHQL_PERSISTED_QUERY_TTL_SECONDS') return 60;
      return defaultValue;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows an arbitrary query without a hash', async () => {
    const middleware = new PersistedQueryMiddleware(redis as never, devConfig as never);
    const res = { status: jest.fn(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(
      { body: { query: 'query { viewer { authenticated } }' } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows an unknown hash without an allowlist check', async () => {
    const middleware = new PersistedQueryMiddleware(redis as never, {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'GRAPHQL_PERSISTED_QUERIES_ONLY') return false;
        if (key === 'GRAPHQL_PERSISTED_QUERIES_ENABLED') return true;
        if (key === 'GRAPHQL_PERSISTED_QUERY_TTL_SECONDS') return 60;
        return defaultValue;
      }),
    } as never);
    redis.get.mockResolvedValue(KNOWN_QUERY);
    const req = {
      body: { extensions: { persistedQuery: { version: 1, sha256Hash: 'not-in-any-allowlist' } } },
    } as never;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(req as never, res as never, next);

    // Hydrated from Redis without any allowlist rejection
    expect(next).toHaveBeenCalled();
  });
});

describe('PersistedQueryMiddleware — per-operation complexity budgets', () => {
  const KNOWN_HASH = 'aabbcc112233';
  const KNOWN_QUERY = 'query HeavyReport { reports { id } }';

  function makeConfig(hash: string) {
    return {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'GRAPHQL_PERSISTED_QUERIES_ONLY') return true;
        if (key === 'GRAPHQL_PERSISTED_QUERIES_ENABLED') return true;
        if (key === 'GRAPHQL_PERSISTED_QUERY_ALLOWLIST') return hash;
        if (key === 'GRAPHQL_PERSISTED_QUERY_TTL_SECONDS') return 60;
        return defaultValue;
      }),
    };
  }

  it('passes through an allowlisted hash and calls next', async () => {
    const redis = { get: jest.fn().mockResolvedValue(KNOWN_QUERY), set: jest.fn() };
    const config = makeConfig(KNOWN_HASH);
    const middleware = new PersistedQueryMiddleware(redis as never, config as never);

    const req = {
      body: { extensions: { persistedQuery: { version: 1, sha256Hash: KNOWN_HASH } } },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await middleware.use(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
  });
});
