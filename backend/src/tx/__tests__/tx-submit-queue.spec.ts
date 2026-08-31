import { Test, TestingModule } from '@nestjs/testing';
import { TxSubmitQueue } from '../tx-submit.queue';
import { TxSubmitWorker } from '../tx-submit.worker';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../metrics/metrics.service';

// Mock BullMQ Queue
const mockJob = { id: 'job-1', returnvalue: null, failedReason: undefined, getState: jest.fn() };
const mockQueue = {
  add: jest.fn().mockResolvedValue(mockJob),
  getJob: jest.fn(),
  getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
  close: jest.fn(),
};
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => mockQueue),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  Job: jest.fn(),
}));
jest.mock('../../redis/client', () => ({ getBullMQConnection: jest.fn().mockReturnValue({}) }));

describe('TxSubmitQueue', () => {
  let queue: TxSubmitQueue;
  let metricsService: any;

  beforeEach(async () => {
    metricsService = { recordQueueDepth: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TxSubmitQueue,
        { provide: ConfigService, useValue: { get: jest.fn((key) => key === 'TX_SUBMIT_QUEUE_MAX_DEPTH' ? 100 : 'tx-submit') } },
        { provide: MetricsService, useValue: metricsService },
      ],
    }).compile();
    queue = module.get(TxSubmitQueue);
    // Inject metrics service
    (queue as any).metrics = metricsService;
  });

  afterEach(() => jest.clearAllMocks());

  it('enqueue returns jobId immediately (queued status)', async () => {
    const jobId = await queue.enqueue({ signed_xdr: 'AAAA==' });
    expect(jobId).toBe('job-1');
    expect(mockQueue.add).toHaveBeenCalledWith('submit', { signed_xdr: 'AAAA==', idempotency_key: undefined }, {});
  });

  it('enqueue uses idempotency_key as jobId', async () => {
    await queue.enqueue({ signed_xdr: 'AAAA==', idempotency_key: 'uuid-123' });
    expect(mockQueue.add).toHaveBeenCalledWith('submit', expect.any(Object), { jobId: 'idem:uuid-123' });
  });

  it('getStatus returns queued for waiting job', async () => {
    mockJob.getState.mockResolvedValue('waiting');
    mockQueue.getJob.mockResolvedValue(mockJob);
    const result = await queue.getStatus('job-1');
    expect(result.status).toBe('queued');
  });

  it('getStatus returns completed with result', async () => {
    const completedJob = { ...mockJob, returnvalue: { hash: 'abc123', status: 'PENDING' }, getState: jest.fn().mockResolvedValue('completed') };
    mockQueue.getJob.mockResolvedValue(completedJob);
    const result = await queue.getStatus('job-1');
    expect(result.status).toBe('completed');
    expect(result.result?.hash).toBe('abc123');
  });

  it('getStatus returns failed with reason', async () => {
    const failedJob = { ...mockJob, failedReason: 'TX_BAD_SEQ: bad seq', getState: jest.fn().mockResolvedValue('failed') };
    mockQueue.getJob.mockResolvedValue(failedJob);
    const result = await queue.getStatus('job-1');
    expect(result.status).toBe('failed');
    expect(result.failedReason).toContain('TX_BAD_SEQ');
  });

  it('getStatus returns unknown for missing job', async () => {
    mockQueue.getJob.mockResolvedValue(undefined);
    const result = await queue.getStatus('nonexistent');
    expect(result.status).toBe('unknown');
  });

  it('enqueue records queue depth metric', async () => {
    mockQueue.getJobCounts = jest.fn().mockResolvedValue({ waiting: 5, active: 2, delayed: 1 });
    await queue.enqueue({ signed_xdr: 'AAAA==' });
    expect(metricsService.recordQueueDepth).toHaveBeenCalledWith({ queue: 'tx-submit', depth: 8 });
  });

  it('enqueue rejects when queue depth exceeds max', async () => {
    mockQueue.getJobCounts = jest.fn().mockResolvedValue({ waiting: 98, active: 3, delayed: 0 });
    await expect(queue.enqueue({ signed_xdr: 'AAAA==' })).rejects.toThrow();
  });

  it('enqueue succeeds when queue depth is under limit', async () => {
    mockQueue.getJobCounts = jest.fn().mockResolvedValue({ waiting: 50, active: 0, delayed: 0 });
    const jobId = await queue.enqueue({ signed_xdr: 'AAAA==' });
    expect(jobId).toBe('job-1');
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('enqueue returns existing job ID if idempotency key already exists', async () => {
    mockQueue.getJobCounts = jest.fn().mockResolvedValue({ waiting: 10, active: 0, delayed: 0 });
    const existingJob = { id: 'idem:uuid-123', returnvalue: { hash: 'abc' }, getState: jest.fn() };
    mockQueue.getJob = jest.fn().mockResolvedValue(existingJob);

    const jobId = await queue.enqueue({ signed_xdr: 'AAAA==', idempotency_key: 'uuid-123' });
    expect(jobId).toBe('idem:uuid-123');
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('enqueue creates new job if idempotency key does not exist', async () => {
    mockQueue.getJobCounts = jest.fn().mockResolvedValue({ waiting: 10, active: 0, delayed: 0 });
    mockQueue.getJob = jest.fn().mockResolvedValue(undefined);

    const jobId = await queue.enqueue({ signed_xdr: 'AAAA==', idempotency_key: 'uuid-456' });
    expect(jobId).toBe('job-1');
    expect(mockQueue.add).toHaveBeenCalledWith('submit', { signed_xdr: 'AAAA==', idempotency_key: 'uuid-456' }, { jobId: 'idem:uuid-456' });
  });
});

describe('TxSubmitWorker', () => {
  it('initializes worker on module init', async () => {
    const { Worker } = await import('bullmq');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TxSubmitWorker,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://rpc') } },
        { provide: MetricsService, useValue: { recordQueueActiveWorkers: jest.fn() } },
      ],
    }).compile();
    const worker = module.get(TxSubmitWorker);
    worker.onModuleInit();
    expect(Worker).toHaveBeenCalled();
  });
});
