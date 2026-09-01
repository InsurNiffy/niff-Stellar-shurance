import { ClaimsService } from '../claims.service';

/**
 * #1326 — appeal status changes must reach GET /claims/status/stream subscribers
 * via ClaimsService.publishStatusChange.
 */
describe('ClaimsService appeal SSE status push', () => {
  afterEach(() => {
    // Drain any leftover listeners from prior assertions.
    const drain: Array<() => void> = [];
    // Re-subscribe then unsubscribe to ensure Set is empty is hard without a
    // reset helper — instead each test unsubscribes its own listener.
    void drain;
  });

  it('delivers UNDER_APPEAL update to matching SSE subscribers', () => {
    const received: Array<{ claimId: string; status: string; updatedAt: string }> = [];
    // subscribeToStatusChanges is an instance method; only needs `this` for nothing
    // related to DI — call via a minimal stub.
    const stub = Object.create(ClaimsService.prototype) as ClaimsService;
    const unsub = stub.subscribeToStatusChanges(['42', '99'], (data) => {
      received.push(data as { claimId: string; status: string; updatedAt: string });
    });

    ClaimsService.publishStatusChange({
      claimId: '42',
      status: 'under_appeal',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });

    // Unrelated claim must not be delivered.
    ClaimsService.publishStatusChange({
      claimId: '7',
      status: 'approved',
      updatedAt: '2026-08-29T00:00:01.000Z',
    });

    expect(received).toEqual([
      {
        claimId: '42',
        status: 'under_appeal',
        updatedAt: '2026-08-29T00:00:00.000Z',
      },
    ]);

    unsub();
  });

  it('delivers appeal-resolution (out of UNDER_APPEAL) to subscribers', () => {
    const received: object[] = [];
    const stub = Object.create(ClaimsService.prototype) as ClaimsService;
    const unsub = stub.subscribeToStatusChanges(['10'], (data) => received.push(data));

    ClaimsService.publishStatusChange({
      claimId: '10',
      status: 'approved',
      updatedAt: '2026-08-29T01:00:00.000Z',
    });

    expect(received).toEqual([
      {
        claimId: '10',
        status: 'approved',
        updatedAt: '2026-08-29T01:00:00.000Z',
      },
    ]);

    unsub();
  });

  it('stops delivering after unsubscribe', () => {
    const received: object[] = [];
    const stub = Object.create(ClaimsService.prototype) as ClaimsService;
    const unsub = stub.subscribeToStatusChanges(['1'], (data) => received.push(data));
    unsub();

    ClaimsService.publishStatusChange({
      claimId: '1',
      status: 'under_appeal',
      updatedAt: '2026-08-29T02:00:00.000Z',
    });

    expect(received).toHaveLength(0);
  });
});
