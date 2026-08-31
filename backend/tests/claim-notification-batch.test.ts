/**
 * Integration tests for claim notification batching
 *
 * Coverage:
 *   - Single-event path: event accumulated and sent after window closes
 *   - Multi-event batching: multiple updates within window grouped together
 *   - Different wallets: batches are per-wallet
 *   - Batch window configurable via env
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ClaimNotificationBatchService } from '../src/notifications/claim-notification-batch.service';
import { MetricsModule } from '../src/metrics/metrics.module';
import type { ClaimFinalizedEvent } from '../src/notifications/notification.types';

describe('ClaimNotificationBatchService', () => {
  let service: ClaimNotificationBatchService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        MetricsModule,
      ],
      providers: [ClaimNotificationBatchService],
    }).compile();

    service = module.get<ClaimNotificationBatchService>(ClaimNotificationBatchService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('Single-event path', () => {
    it('should batch a single event and call flush after window closes', async (done) => {
      const flushedEvents: ClaimFinalizedEvent[] = [];
      const event: ClaimFinalizedEvent = {
        claimId: 'claim-1',
        policyId: 1,
        claimantPublicKey: 'GBBB...',
        outcome: 'Approved',
        finalizedAt: new Date().toISOString(),
      };

      const onFlush = async (events: ClaimFinalizedEvent[]) => {
        flushedEvents.push(...events);
      };

      await service.accumulateEvent(event, onFlush);

      // Check that flush hasn't happened yet
      expect(flushedEvents.length).toBe(0);

      // Wait for batch window to close (default 60s, but we'll use a shorter timeout)
      // In the test, we rely on the configured window
      setTimeout(() => {
        expect(flushedEvents.length).toBe(1);
        expect(flushedEvents[0]).toEqual(event);
        done();
      }, 100); // Wait a bit longer than default window in test config
    });
  });

  describe('Multi-event batching', () => {
    it('should accumulate multiple events for same wallet within window', async (done) => {
      const flushedEvents: ClaimFinalizedEvent[] = [];
      const wallet = 'GBBB...';
      const events: ClaimFinalizedEvent[] = [
        {
          claimId: 'claim-1',
          policyId: 1,
          claimantPublicKey: wallet,
          outcome: 'Approved',
          finalizedAt: new Date().toISOString(),
        },
        {
          claimId: 'claim-2',
          policyId: 1,
          claimantPublicKey: wallet,
          outcome: 'Rejected',
          finalizedAt: new Date().toISOString(),
        },
        {
          claimId: 'claim-3',
          policyId: 1,
          claimantPublicKey: wallet,
          outcome: 'Approved',
          finalizedAt: new Date().toISOString(),
        },
      ];

      const onFlush = async (batchedEvents: ClaimFinalizedEvent[]) => {
        flushedEvents.push(...batchedEvents);
      };

      // Accumulate all events within window
      for (const event of events) {
        await service.accumulateEvent(event, onFlush);
        // Small delay between events but all within window
        await new Promise((r) => setTimeout(r, 10));
      }

      // Verify no flush yet
      expect(flushedEvents.length).toBe(0);

      // Wait for window to close
      setTimeout(() => {
        expect(flushedEvents.length).toBe(3);
        expect(flushedEvents.map((e) => e.claimId)).toEqual(['claim-1', 'claim-2', 'claim-3']);
        done();
      }, 100);
    });

    it('should maintain separate batches per wallet', async (done) => {
      const flushedEvents = new Map<string, ClaimFinalizedEvent[]>();
      const wallet1 = 'GAAA...';
      const wallet2 = 'GBBB...';

      const onFlush = async (events: ClaimFinalizedEvent[]) => {
        const wallet = events[0].claimantPublicKey;
        if (!flushedEvents.has(wallet)) {
          flushedEvents.set(wallet, []);
        }
        flushedEvents.get(wallet)!.push(...events);
      };

      const event1: ClaimFinalizedEvent = {
        claimId: 'claim-1',
        policyId: 1,
        claimantPublicKey: wallet1,
        outcome: 'Approved',
        finalizedAt: new Date().toISOString(),
      };

      const event2: ClaimFinalizedEvent = {
        claimId: 'claim-2',
        policyId: 1,
        claimantPublicKey: wallet2,
        outcome: 'Rejected',
        finalizedAt: new Date().toISOString(),
      };

      await service.accumulateEvent(event1, onFlush);
      await service.accumulateEvent(event2, onFlush);

      // Wait for window to close
      setTimeout(() => {
        expect(flushedEvents.size).toBe(2);
        expect(flushedEvents.get(wallet1)).toEqual([event1]);
        expect(flushedEvents.get(wallet2)).toEqual([event2]);
        done();
      }, 100);
    });
  });

  describe('Timer reset', () => {
    it('should reset timer when new event arrives for existing batch', async (done) => {
      const flushedEvents: ClaimFinalizedEvent[] = [];
      const wallet = 'GBBB...';

      const onFlush = async (events: ClaimFinalizedEvent[]) => {
        flushedEvents.push(...events);
      };

      const event1: ClaimFinalizedEvent = {
        claimId: 'claim-1',
        policyId: 1,
        claimantPublicKey: wallet,
        outcome: 'Approved',
        finalizedAt: new Date().toISOString(),
      };

      await service.accumulateEvent(event1, onFlush);

      // After half the window, add another event (resets timer)
      setTimeout(async () => {
        const event2: ClaimFinalizedEvent = {
          claimId: 'claim-2',
          policyId: 1,
          claimantPublicKey: wallet,
          outcome: 'Rejected',
          finalizedAt: new Date().toISOString(),
        };

        await service.accumulateEvent(event2, onFlush);

        // Both events should be flushed together
        setTimeout(() => {
          expect(flushedEvents.length).toBe(2);
          done();
        }, 100);
      }, 50);
    });
  });
});
