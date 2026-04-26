/// <reference types="jest" />
import { createQueryClient, STALE_TIMES } from '../queryClientConfig';

describe('createQueryClient', () => {
  it('returns a QueryClient instance', () => {
    const client = createQueryClient();
    expect(client).toBeDefined();
    expect(typeof client.getQueryCache).toBe('function');
  });

  it('default staleTime matches STALE_TIMES.default', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(STALE_TIMES.default);
  });

  it('does not retry on 4xx errors (except 429)', () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;
    if (typeof retry !== 'function') throw new Error('retry should be a function');

    const err400 = { status: 400 };
    const err401 = { status: 401 };
    const err404 = { status: 404 };
    const err429 = { status: 429 };
    const err500 = { status: 500 };
    const networkErr = new Error('Failed to fetch');

    expect(retry(0, err400)).toBe(false);
    expect(retry(0, err401)).toBe(false);
    expect(retry(0, err404)).toBe(false);
    // 429 is retryable
    expect(retry(0, err429)).toBe(true);
    // 5xx is retryable up to 3 attempts
    expect(retry(0, err500)).toBe(true);
    expect(retry(2, err500)).toBe(true);
    expect(retry(3, err500)).toBe(false);
    // Network errors are retryable
    expect(retry(0, networkErr)).toBe(true);
  });

  it('retryDelay uses exponential backoff capped at 30s', () => {
    const client = createQueryClient();
    const retryDelay = client.getDefaultOptions().queries?.retryDelay;
    if (typeof retryDelay !== 'function') throw new Error('retryDelay should be a function');

    expect(retryDelay(0, new Error())).toBe(1_000);
    expect(retryDelay(1, new Error())).toBe(2_000);
    expect(retryDelay(2, new Error())).toBe(4_000);
    // Capped at 30s
    expect(retryDelay(10, new Error())).toBe(30_000);
  });

  it('refetchOnWindowFocus is false by default', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('refetchOnReconnect is true', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.refetchOnReconnect).toBe(true);
  });

  it('refetchIntervalInBackground is false', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.refetchIntervalInBackground).toBe(false);
  });

  it('does not auto-retry mutations', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe('STALE_TIMES', () => {
  it('votes stale time is shortest (most time-sensitive)', () => {
    expect(STALE_TIMES.votes).toBeLessThan(STALE_TIMES.claims);
    expect(STALE_TIMES.claims).toBeLessThan(STALE_TIMES.policies);
  });

  it('all values are positive numbers', () => {
    Object.values(STALE_TIMES).forEach((v) => {
      expect(v).toBeGreaterThan(0);
    });
  });
});
