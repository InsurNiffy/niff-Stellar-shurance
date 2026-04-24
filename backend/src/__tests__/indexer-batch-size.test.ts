import { resolveBatchSize, IndexerService } from '../src/indexer/indexer.service';

describe('resolveBatchSize', () => {
  const orig = process.env.INDEXER_BATCH_SIZE;
  afterEach(() => {
    if (orig === undefined) delete process.env.INDEXER_BATCH_SIZE;
    else process.env.INDEXER_BATCH_SIZE = orig;
  });

  it('defaults to 10 when env var is unset', () => {
    delete process.env.INDEXER_BATCH_SIZE;
    expect(resolveBatchSize()).toBe(10);
  });

  it('returns the configured value', () => {
    process.env.INDEXER_BATCH_SIZE = '25';
    expect(resolveBatchSize()).toBe(25);
  });

  it('throws when value is 0 (below minimum)', () => {
    process.env.INDEXER_BATCH_SIZE = '0';
    expect(() => resolveBatchSize()).toThrow('between 1 and 100');
  });

  it('throws when value is 101 (above maximum)', () => {
    process.env.INDEXER_BATCH_SIZE = '101';
    expect(() => resolveBatchSize()).toThrow('between 1 and 100');
  });

  it('throws when value is not a number', () => {
    process.env.INDEXER_BATCH_SIZE = 'fast';
    expect(() => resolveBatchSize()).toThrow('must be a number');
  });

  it('accepts boundary value 1', () => {
    process.env.INDEXER_BATCH_SIZE = '1';
    expect(resolveBatchSize()).toBe(1);
  });

  it('accepts boundary value 100', () => {
    process.env.INDEXER_BATCH_SIZE = '100';
    expect(resolveBatchSize()).toBe(100);
  });
});

describe('IndexerService.processBatch', () => {
  it('calls fetchLedgers with the configured batch size', async () => {
    process.env.INDEXER_BATCH_SIZE = '5';
    const service = new IndexerService();
    const fetchFn = jest.fn().mockResolvedValue([1, 2, 3, 4, 5]);

    await service.processBatch(100, fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(100, 5);
  });

  it('returns the next ledger sequence after the batch', async () => {
    process.env.INDEXER_BATCH_SIZE = '3';
    const service = new IndexerService();
    const fetchFn = jest.fn().mockResolvedValue([1, 2, 3]);

    const next = await service.processBatch(50, fetchFn);

    expect(next).toBe(53);
  });

  it('tracks average batch duration', async () => {
    process.env.INDEXER_BATCH_SIZE = '2';
    const service = new IndexerService();
    const fetchFn = jest.fn().mockResolvedValue([1, 2]);

    await service.processBatch(0, fetchFn);
    expect(service.getAverageBatchDurationMs()).toBeGreaterThanOrEqual(0);
  });
});
