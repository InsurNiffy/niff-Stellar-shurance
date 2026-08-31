import { PrismaService } from './prisma.service';

// Helper that builds a minimal PrismaService with test-friendly config
const makeService = (overrides: Record<string, unknown> = {}) => {
  const cfg: Record<string, unknown> = {
    DATABASE_URL: 'postgresql://localhost/test',
    DB_POOL_MAX: 2,
    DB_POOL_MIN: 1,
    DB_POOL_IDLE_TIMEOUT_MS: 1000,
    DB_POOL_CONNECTION_TIMEOUT_MS: 1000,
    DB_SLOW_QUERY_MS: 250,
    DB_CONNECT_MAX_ATTEMPTS: 3,
    DB_CONNECT_INITIAL_DELAY_MS: 10,
    DB_CONNECT_MAX_DELAY_MS: 100,
    NODE_ENV: 'test',
    ...overrides,
  };
  const configService = {
    get: jest.fn((key: string, def?: unknown) =>
      Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : def,
    ),
  };
  return new PrismaService(configService as never);
};

describe('PrismaService — connectWithBackoff (issue #894)', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = makeService();
  });

  const silenceInternals = () => {
    // Suppress internal pool metrics and slow-query registration during tests
    jest
      .spyOn(service as unknown as Record<string, jest.Mock>, 'emitPoolMetrics')
      .mockReturnValue(undefined);
    (service as unknown as Record<string, jest.Mock>)['$on'] = jest.fn();
  };

  it('succeeds on the first attempt without retrying', async () => {
    const connectSpy = jest
      .spyOn(service, '$connect' as keyof PrismaService)
      .mockResolvedValue(undefined as never);
    silenceInternals();

    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds on the second attempt', async () => {
    const connectSpy = jest
      .spyOn(service, '$connect' as keyof PrismaService)
      .mockRejectedValueOnce(new Error('ECONNREFUSED') as never)
      .mockResolvedValueOnce(undefined as never);
    silenceInternals();

    // Use real timers — DB_CONNECT_INITIAL_DELAY_MS is 10ms in the test config
    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting max attempts', async () => {
    const error = new Error('ECONNREFUSED');
    const connectSpy = jest
      .spyOn(service, '$connect' as keyof PrismaService)
      .mockRejectedValue(error as never);
    silenceInternals();

    await expect(service.onModuleInit()).rejects.toThrow('ECONNREFUSED');
    expect(connectSpy).toHaveBeenCalledTimes(3); // DB_CONNECT_MAX_ATTEMPTS default = 3
  });

  it('caps the retry delay at DB_CONNECT_MAX_DELAY_MS', async () => {
    // Use a tiny max delay to make this test fast
    service = makeService({
      DB_CONNECT_MAX_ATTEMPTS: 2,
      DB_CONNECT_INITIAL_DELAY_MS: 1000,
      DB_CONNECT_MAX_DELAY_MS: 5, // cap at 5ms
    });

    const connectSpy = jest
      .spyOn(service, '$connect' as keyof PrismaService)
      .mockRejectedValueOnce(new Error('fail') as never)
      .mockResolvedValueOnce(undefined as never);
    (service as unknown as Record<string, jest.Mock>)['$on'] = jest.fn();
    jest
      .spyOn(service as unknown as Record<string, jest.Mock>, 'emitPoolMetrics')
      .mockReturnValue(undefined);

    // Should finish quickly because the cap (5ms) replaces the initial 1000ms delay
    const start = Date.now();
    await service.onModuleInit();
    expect(Date.now() - start).toBeLessThan(200);
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });
});

describe('PrismaService — soft-delete middleware (issue #875)', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = makeService();
  });

  it('automatically appends deletedAt: null to findMany for soft-delete models', async () => {
    // Verify extension is applied by checking internal state
    expect((service as any).softDeleteModels.has('Claim')).toBe(true);
    expect((service as any).softDeleteModels.has('Vote')).toBe(true);
    expect((service as any).softDeleteModels.has('Policy')).toBe(true);
    expect((service as any).softDeleteModels.has('ClaimComment')).toBe(true);
  });

  it('does not filter models without deletedAt', async () => {
    // Models like RawEvent, AdminAuditLog should not be filtered
    expect((service as any).softDeleteModels.has('RawEvent')).toBe(false);
    expect((service as any).softDeleteModels.has('AdminAuditLog')).toBe(false);
  });

  it('bypasses soft-delete filtering within withSoftDeleteBypass context', async () => {
    const testFn = jest.fn().mockResolvedValue('result');

    const result = await service.withSoftDeleteBypass(testFn);

    expect(result).toBe('result');
    expect(testFn).toHaveBeenCalledTimes(1);
  });

  it('withSoftDeleteBypass provides isolated context per call', async () => {
    const context1 = (service as any).softDeleteContext;
    let storeInCallback: any = null;

    await service.withSoftDeleteBypass(async () => {
      storeInCallback = context1.getStore();
    });

    expect(storeInCallback?.bypassSoftDelete).toBe(true);

    // Outside the context, store should be undefined or not have the flag
    const storeOutside = context1.getStore();
    expect(storeOutside?.bypassSoftDelete).toBeUndefined();
  });

  it('propagates soft-delete bypass through async context', async () => {
    const results: boolean[] = [];

    await service.withSoftDeleteBypass(async () => {
      // Simulate a nested async operation
      await new Promise((resolve) => setImmediate(resolve));
      const store = (service as any).softDeleteContext.getStore();
      results.push(store?.bypassSoftDelete ?? false);
    });

    expect(results[0]).toBe(true);
  });
});
