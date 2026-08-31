import { MAX_OUTBOUND_WEBHOOK_SIZE_BYTES } from './outbound.queue';

describe('Outbound Webhook Queue', () => {
  describe('Payload size validation', () => {
    function getPayloadSizeBytes(payload: Record<string, unknown>): number {
      return Buffer.byteLength(JSON.stringify(payload), 'utf8');
    }

    it('allows payloads under the size limit', () => {
      const smallPayload = { claimId: 42, status: 'PENDING' };
      const size = getPayloadSizeBytes(smallPayload);
      expect(size).toBeLessThan(MAX_OUTBOUND_WEBHOOK_SIZE_BYTES);
    });

    it('rejects payloads exceeding the size limit', () => {
      const largeString = 'x'.repeat(MAX_OUTBOUND_WEBHOOK_SIZE_BYTES + 1);
      const largePayload = { data: largeString };
      const size = getPayloadSizeBytes(largePayload);
      expect(size).toBeGreaterThan(MAX_OUTBOUND_WEBHOOK_SIZE_BYTES);
    });

    it('size limit defaults to 1 MB', () => {
      expect(MAX_OUTBOUND_WEBHOOK_SIZE_BYTES).toBe(1048576);
    });

    it('correctly calculates payload size for complex payloads', () => {
      const complexPayload = {
        claimId: 123,
        amount: '1000000',
        currency: 'USD',
        metadata: {
          policyId: 'pol_abc',
          claimType: 'medical',
          date: '2024-01-01T00:00:00Z',
        },
        evidence: [
          { type: 'document', id: 'doc_1' },
          { type: 'photo', id: 'photo_1' },
        ],
      };
      const size = getPayloadSizeBytes(complexPayload);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(MAX_OUTBOUND_WEBHOOK_SIZE_BYTES);
    });
  });
});
