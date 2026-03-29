const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'queued-job-id' });

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: (...args: unknown[]) => mockQueueAdd(...args),
  })),
}));

jest.mock('../redis/client', () => ({
  getBullMQConnection: () => ({}),
}));

import { AdminService } from './admin.service';

describe('AdminService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: 'queued-job-id' });
  });

  describe('enqueueReindex', () => {
    it('sets last_processed_ledger to fromLedger-1 and enqueues with network', async () => {
      const upsert = jest.fn();
      const prisma = {
        $transaction: jest.fn(async (fn: (t: { ledgerCursor: { upsert: jest.Mock } }) => Promise<void>) =>
          fn({ ledgerCursor: { upsert } })),
      };

      const svc = new AdminService(prisma as never);
      const jobId = await svc.enqueueReindex(500, 'testnet');

      expect(jobId).toBe('queued-job-id');
      expect(upsert).toHaveBeenCalledWith({
        where: { network: 'testnet' },
        create: { network: 'testnet', lastProcessedLedger: 499 },
        update: { lastProcessedLedger: 499 },
      });
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'reindex',
        { fromLedger: 500, network: 'testnet' },
        expect.objectContaining({
          jobId: expect.stringMatching(/^reindex-testnet-500-/),
        }),
      );
    });

    it('clamps at 0 when fromLedger is 0', async () => {
      const upsert = jest.fn();
      const prisma = {
        $transaction: jest.fn(async (fn: (t: { ledgerCursor: { upsert: jest.Mock } }) => Promise<void>) =>
          fn({ ledgerCursor: { upsert } })),
      };
      const svc = new AdminService(prisma as never);
      await svc.enqueueReindex(0, 'public');
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ lastProcessedLedger: 0 }),
        }),
      );
    });
  });
});
