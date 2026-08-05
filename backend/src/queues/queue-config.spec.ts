import {
  getQueueConcurrency,
  getQueueRetryConfig,
  resetRetryOverridesCache,
} from './queue-config';

describe('getQueueConcurrency', () => {
  it('returns defaults when concurrency map is empty', () => {
    expect(getQueueConcurrency('tx-submit')).toBe(1);
    expect(getQueueConcurrency('claim-events')).toBe(5);
    expect(getQueueConcurrency('claim-payouts')).toBe(3);
  });

  it('returns defaults when concurrency map is undefined', () => {
    expect(getQueueConcurrency('tx-submit', undefined)).toBe(1);
    expect(getQueueConcurrency('claim-events', undefined)).toBe(5);
  });

  it('parses concurrency map correctly', () => {
    const map = 'tx-submit=1,claim-events=10,claim-payouts=5';
    expect(getQueueConcurrency('tx-submit', map)).toBe(1);
    expect(getQueueConcurrency('claim-events', map)).toBe(10);
    expect(getQueueConcurrency('claim-payouts', map)).toBe(5);
  });

  it('handles whitespace in concurrency map', () => {
    const map = '  tx-submit = 2  ,  claim-events = 8  ';
    expect(getQueueConcurrency('tx-submit', map)).toBe(2);
    expect(getQueueConcurrency('claim-events', map)).toBe(8);
  });

  it('falls back to defaults for unmapped queues', () => {
    const map = 'tx-submit=1';
    expect(getQueueConcurrency('tx-submit', map)).toBe(1);
    expect(getQueueConcurrency('claim-events', map)).toBe(5); // default
    expect(getQueueConcurrency('claim-payouts', map)).toBe(3); // default
  });

  it('ignores invalid entries in concurrency map', () => {
    const map = 'tx-submit=1,invalid,claim-events=5,bad=abc';
    expect(getQueueConcurrency('tx-submit', map)).toBe(1);
    expect(getQueueConcurrency('claim-events', map)).toBe(5);
    expect(getQueueConcurrency('claim-payouts', map)).toBe(3); // default
  });

  it('ignores zero or negative concurrency values', () => {
    const map = 'tx-submit=0,claim-events=-1';
    expect(getQueueConcurrency('tx-submit', map)).toBe(1); // default, 0 is invalid
    expect(getQueueConcurrency('claim-events', map)).toBe(5); // default, -1 is invalid
  });

  it('enforces tx-submit defaults to 1 for nonce safety', () => {
    expect(getQueueConcurrency('tx-submit')).toBe(1);
    expect(getQueueConcurrency('tx-submit', '')).toBe(1);
    expect(getQueueConcurrency('tx-submit', 'claim-events=10')).toBe(1);
  });

  it('returns defaults for new queues: indexer, notifications, reindex, backfill', () => {
    expect(getQueueConcurrency('indexer')).toBe(5);
    expect(getQueueConcurrency('notifications')).toBe(5);
    expect(getQueueConcurrency('reindex')).toBe(3);
    expect(getQueueConcurrency('backfill')).toBe(3);
    expect(getQueueConcurrency('policy-renewal-reminders')).toBe(3);
    expect(getQueueConcurrency('webhooks')).toBe(5);
    expect(getQueueConcurrency('outbound-webhooks')).toBe(5);
  });
});

describe('getQueueRetryConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.QUEUE_RETRY_MAP;
    resetRetryOverridesCache();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('default values', () => {
    it('returns correct defaults for tx-submit', () => {
      const cfg = getQueueRetryConfig('tx-submit');
      expect(cfg).toEqual({
        maxAttempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      });
    });

    it('returns correct defaults for claim-events', () => {
      const cfg = getQueueRetryConfig('claim-events');
      expect(cfg).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
      });
    });

    it('returns correct defaults for claim-payouts', () => {
      const cfg = getQueueRetryConfig('claim-payouts');
      expect(cfg).toEqual({
        maxAttempts: 7,
        backoff: { type: 'exponential', delay: 5_000 },
      });
    });

    it('returns correct defaults for indexer', () => {
      const cfg = getQueueRetryConfig('indexer');
      expect(cfg).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
      });
    });

    it('returns correct defaults for notifications', () => {
      const cfg = getQueueRetryConfig('notifications');
      expect(cfg).toEqual({
        maxAttempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
      });
    });

    it('returns correct defaults for reindex', () => {
      const cfg = getQueueRetryConfig('reindex');
      expect(cfg).toEqual({
        maxAttempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      });
    });

    it('returns correct defaults for backfill', () => {
      const cfg = getQueueRetryConfig('backfill');
      expect(cfg).toEqual({
        maxAttempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      });
    });

    it('returns correct defaults for policy-renewal-reminders', () => {
      const cfg = getQueueRetryConfig('policy-renewal-reminders');
      expect(cfg).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
      });
    });

    it('returns correct defaults for webhooks', () => {
      const cfg = getQueueRetryConfig('webhooks');
      expect(cfg).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
      });
    });

    it('returns correct defaults for outbound-webhooks', () => {
      const cfg = getQueueRetryConfig('outbound-webhooks');
      expect(cfg).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
      });
    });
  });

  describe('QUEUE_RETRY_MAP overrides', () => {
    it('overrides a single queue with exponential backoff', () => {
      process.env.QUEUE_RETRY_MAP = 'tx-submit=10,exponential,5000';
      resetRetryOverridesCache();
      const cfg = getQueueRetryConfig('tx-submit');
      expect(cfg).toEqual({
        maxAttempts: 10,
        backoff: { type: 'exponential', delay: 5_000 },
      });
    });

    it('overrides a queue with fixed backoff', () => {
      process.env.QUEUE_RETRY_MAP = 'webhooks=7,fixed,30000';
      resetRetryOverridesCache();
      const cfg = getQueueRetryConfig('webhooks');
      expect(cfg).toEqual({
        maxAttempts: 7,
        backoff: { type: 'fixed', delay: 30_000 },
      });
    });

    it('overrides multiple queues', () => {
      process.env.QUEUE_RETRY_MAP =
        'tx-submit=5,exponential,3000;claim-events=10,exponential,2000;webhooks=3,fixed,10000';
      resetRetryOverridesCache();

      expect(getQueueRetryConfig('tx-submit')).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
      });
      expect(getQueueRetryConfig('claim-events')).toEqual({
        maxAttempts: 10,
        backoff: { type: 'exponential', delay: 2_000 },
      });
      expect(getQueueRetryConfig('webhooks')).toEqual({
        maxAttempts: 3,
        backoff: { type: 'fixed', delay: 10_000 },
      });
    });

    it('falls back to defaults for queues not in the map', () => {
      process.env.QUEUE_RETRY_MAP = 'tx-submit=10,exponential,5000';
      resetRetryOverridesCache();

      // This one is overridden
      expect(getQueueRetryConfig('tx-submit').maxAttempts).toBe(10);
      // These fall back to defaults
      expect(getQueueRetryConfig('claim-events')).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
      });
      expect(getQueueRetryConfig('claim-payouts')).toEqual({
        maxAttempts: 7,
        backoff: { type: 'exponential', delay: 5_000 },
      });
    });

    it('handles whitespace in the map', () => {
      process.env.QUEUE_RETRY_MAP =
        '  tx-submit = 5 , exponential , 3000 ; claim-events = 10 , exponential , 2000  ';
      resetRetryOverridesCache();

      expect(getQueueRetryConfig('tx-submit')).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
      });
      expect(getQueueRetryConfig('claim-events')).toEqual({
        maxAttempts: 10,
        backoff: { type: 'exponential', delay: 2_000 },
      });
    });

    it('ignores empty string', () => {
      process.env.QUEUE_RETRY_MAP = '';
      resetRetryOverridesCache();

      expect(getQueueRetryConfig('tx-submit')).toEqual({
        maxAttempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      });
    });

    it('ignores invalid entries gracefully', () => {
      process.env.QUEUE_RETRY_MAP =
        'invalid;also-invalid;tx-submit=5,exponential,3000;bad=one,two;claim-events=abc,exponential,1000';
      resetRetryOverridesCache();

      // Valid entry
      expect(getQueueRetryConfig('tx-submit')).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
      });
      // Invalid entry (non-numeric maxAttempts) — falls back to default
      expect(getQueueRetryConfig('claim-events')).toEqual({
        maxAttempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
      });
      // Bare invalid entries — causes no errors
      expect(getQueueRetryConfig('claim-payouts')).toEqual({
        maxAttempts: 7,
        backoff: { type: 'exponential', delay: 5_000 },
      });
    });

    it('ignores entries with maxAttempts < 1', () => {
      process.env.QUEUE_RETRY_MAP = 'tx-submit=0,exponential,2000;claim-events=-1,fixed,1000';
      resetRetryOverridesCache();

      // Both invalid — fall back to defaults
      expect(getQueueRetryConfig('tx-submit').maxAttempts).toBe(3);
      expect(getQueueRetryConfig('claim-events').maxAttempts).toBe(5);
    });

    it('ignores entries with invalid backoff type', () => {
      process.env.QUEUE_RETRY_MAP = 'tx-submit=5,linear,2000';
      resetRetryOverridesCache();

      expect(getQueueRetryConfig('tx-submit').maxAttempts).toBe(3); // default
    });

    it('ignores entries with delay < 1', () => {
      process.env.QUEUE_RETRY_MAP = 'tx-submit=5,exponential,0';
      resetRetryOverridesCache();

      expect(getQueueRetryConfig('tx-submit').maxAttempts).toBe(3); // default
    });
  });
});
