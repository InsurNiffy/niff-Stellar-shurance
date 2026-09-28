import { WebhookDeliveryService, WEBHOOK_HTTP_POST, HttpPostFn } from './webhook-delivery.service';
import { signRawBody, verifySignature } from './signature';

const SECRET = 'whsec_delivery_secret_1234';
const TARGET = 'https://partners.example.com/hooks/niffy';

function makeService(httpPost: HttpPostFn, prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    webhookDelivery: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...prismaOverrides,
  };
  const service = new WebhookDeliveryService(prisma as never, httpPost);
  return { service, prisma };
}

describe('WebhookDeliveryService — signing + delivery log (#1484)', () => {
  const job = {
    targetUrl: TARGET,
    eventType: 'claim.finalized',
    idempotencyKey: 'claim_filed:tx123',
    payload: { claimId: 42, status: 'FINALIZED' },
    secret: SECRET,
    attempt: 1,
  };

  it('POSTs a signed body with X-Niffy-Signature and idempotency headers', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const { service, prisma } = makeService(httpPost);

    const result = await service.deliver(job);

    expect(result.success).toBe(true);
    expect(result.responseCode).toBe(200);

    const [url, body, headers] = httpPost.mock.calls[0];
    expect(url).toBe(TARGET);
    expect(JSON.parse(body)).toEqual(job.payload);
    expect(headers['X-Event-Type']).toBe('claim.finalized');
    expect(headers['X-Idempotency-Key']).toBe('claim_filed:tx123');
    expect(headers['X-Niffy-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(headers['Content-Type']).toBe('application/json');

    // Partner-side verification of the exact bytes on the wire.
    expect(verifySignature(headers['X-Niffy-Signature'], body, SECRET).ok).toBe(true);
    expect(signRawBody(SECRET, body, Number(headers['X-Niffy-Timestamp'])).length).toBeGreaterThan(0);

    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUrl: TARGET,
          eventType: 'claim.finalized',
          idempotencyKey: 'claim_filed:tx123',
          attempt: 1,
          success: true,
          responseCode: 200,
        }),
      }),
    );
  });

  it('logs non-2xx response codes as failed deliveries', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 503 });
    const { service, prisma } = makeService(httpPost);

    const result = await service.deliver({ ...job, attempt: 2 });

    expect(result.success).toBe(false);
    expect(result.responseCode).toBe(503);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: false, responseCode: 503, attempt: 2 }),
      }),
    );
  });

  it('logs transport errors without throwing', async () => {
    const httpPost = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { service, prisma } = makeService(httpPost);

    const result = await service.deliver({ ...job, attempt: 3 });

    expect(result).toMatchObject({ success: false, error: 'ECONNREFUSED' });
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          responseCode: null,
          errorMessage: 'ECONNREFUSED',
        }),
      }),
    );
  });

  it('still records the delivery when the log write fails', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 200 });
    const { service } = makeService(httpPost, {
      webhookDelivery: { create: jest.fn().mockRejectedValue(new Error('db down')) },
    });

    await expect(service.deliver(job)).resolves.toMatchObject({ success: true });
  });

  it('returns recent delivery log entries for a target URL', async () => {
    const rows = [{ id: '1', targetUrl: TARGET, success: true }];
    const httpPost = jest.fn();
    const { service, prisma } = makeService(httpPost);
    prisma.webhookDelivery.findMany.mockResolvedValue(rows);

    await expect(service.deliveryLog(TARGET)).resolves.toEqual(rows);
    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { targetUrl: TARGET } }),
    );
  });

  it('omits the signature header when no secret is configured', async () => {
    const httpPost = jest.fn().mockResolvedValue({ status: 204 });
    const { service } = makeService(httpPost);

    await service.deliver({ ...job, secret: undefined });

    const headers = httpPost.mock.calls[0][2];
    expect(headers['X-Niffy-Signature']).toBeUndefined();
    expect(headers['X-Event-Type']).toBe('claim.finalized');
  });
});

describe('WEBHOOK_HTTP_POST injection token', () => {
  it('is exported for module/test wiring', () => {
    expect(WEBHOOK_HTTP_POST).toBe('WEBHOOK_HTTP_POST');
  });
});
