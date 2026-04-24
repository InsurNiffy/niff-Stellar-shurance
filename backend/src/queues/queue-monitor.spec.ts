/**
 * Integration tests: failed jobs land in the dead-letter (failed) set
 * after exhausting max retries, and can be replayed via QueueMonitorService.
 *
 * Uses an in-memory BullMQ setup with ioredis-mock so no real Redis is needed.
 */
import { Test } from '@nestjs/testing';
import { Queue, Worker, Job } from 'bullmq';
import { QueueMonitorService, DLQ_MAX_ATTEMPTS } from './queue-monitor.service';
import { MetricsService } from '../metrics/metrics.service';

// Minimal MetricsService stub
const metricsMock = {
  dlqDepth: { set: jest.fn() },
  dlqJobFailed: { inc: jest.fn() },
};

// We test with a real in-process Queue/Worker backed by ioredis-mock
jest.mock('../redis/client', () => ({
  getBullMQConnection: () => {
     
    const IORedis = require('ioredis-mock');
    return new IORedis();
  },
}));

describe('QueueMonitorService — DLQ behaviour', () => {
  let service: QueueMonitorService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        QueueMonitorService,
        { provide: MetricsService, useValue: metricsMock },
      ],
    }).compile();

    service = module.get(QueueMonitorService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });

  it('moves a job to the failed set after max retries', async () => {
    // Grab the indexer queue that QueueMonitorService manages
    const queues = service.getQueues();
    const indexerQueue = queues.find((q) => q.name === 'indexer')!;
    expect(indexerQueue).toBeDefined();

    // Add a job that always throws
    const job = await indexerQueue.add('test-fail', { payload: 'boom' }, {
      attempts: DLQ_MAX_ATTEMPTS,
      backoff: { type: 'fixed', delay: 0 },
    });

    // Spin up a worker that always fails
    const worker = new Worker(
      'indexer',
      async () => { throw new Error('intentional failure'); },
      {
        connection: (indexerQueue as any).opts.connection,
        autorun: true,
      },
    );

    // Wait until the job is exhausted
    await new Promise<void>((resolve) => {
      worker.on('failed', (_job: Job | undefined, _err: Error) => {
        if ((_job?.attemptsMade ?? 0) >= DLQ_MAX_ATTEMPTS) resolve();
      });
    });

    await worker.close();

    const failedJobs = await indexerQueue.getFailed();
    expect(failedJobs.some((j) => j.id === job.id)).toBe(true);
  }, 20_000);

  it('increments dlqJobFailed metric when a job is exhausted', async () => {
    const queues = service.getQueues();
    const q = queues.find((q) => q.name === 'notifications')!;

    await q.add('notify-fail', { userId: 'u1' }, {
      attempts: DLQ_MAX_ATTEMPTS,
      backoff: { type: 'fixed', delay: 0 },
    });

    const worker = new Worker(
      'notifications',
      async () => { throw new Error('smtp down'); },
      { connection: (q as any).opts.connection, autorun: true },
    );

    await new Promise<void>((resolve) => {
      worker.on('failed', (_job: Job | undefined) => {
        if ((_job?.attemptsMade ?? 0) >= DLQ_MAX_ATTEMPTS) resolve();
      });
    });

    await worker.close();

    expect(metricsMock.dlqJobFailed.inc).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'notifications', job_name: 'notify-fail' }),
    );
  }, 20_000);

  it('replayJob moves a failed job back to waiting', async () => {
    const queues = service.getQueues();
    const q = queues.find((q) => q.name === 'indexer')!;

    // Manually add a job and mark it failed
    const job = await q.add('replay-me', { x: 1 }, { attempts: 1, backoff: { type: 'fixed', delay: 0 } });

    const worker = new Worker(
      'indexer',
      async () => { throw new Error('fail once'); },
      { connection: (q as any).opts.connection, autorun: true },
    );

    await new Promise<void>((resolve) => {
      worker.on('failed', () => resolve());
    });
    await worker.close();

    // Job should be in failed set
    const before = await q.getFailed();
    expect(before.some((j) => j.id === job.id)).toBe(true);

    // Replay it
    await service.replayJob('indexer', job.id!);

    // Should no longer be in failed set
    const after = await q.getFailed();
    expect(after.some((j) => j.id === job.id)).toBe(false);
  }, 20_000);
});
