/**
 * Webhook integration tests — #409
 *
 * Covers:
 *   - HMAC signature verification (valid / invalid)
 *   - Replay attack rejection (timestamp out of tolerance)
 *   - Idempotency deduplication
 *   - Unknown provider rejection
 *   - IP allowlist enforcement
 *   - Queue enqueue on valid delivery
 *   - Delivery history and manual retry (admin endpoints)
 */

import { createHmac } from 'crypto';
import { Request, Response } from 'express';
import { handleWebhook, getDeliveryHistoryHandler, retryDeliveryHandler } from './webhook.controller';
import { _resetIdempotencyStore } from '../webhooks/idempotency';
import { setWebhookConfig, resetWebhookConfig } from '../webhooks/config';
import { webhookQueue, getDeliveryHistory, retryFailedJob } from '../webhooks/queue';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../webhooks/queue', () => ({
  webhookQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) },
  getDeliveryHistory: jest.fn(),
  retryFailedJob: jest.fn(),
  getQueueStats: jest.fn().mockResolvedValue({ pending: 0, processed: 0, failed: 0 }),
}));

const SECRET = 'test-webhook-secret';
const NOW = Math.floor(Date.now() / 1000);

function makeReq(overrides: Partial<Request & { rawBody?: Buffer }> = {}): Request & { rawBody?: Buffer } {
  const body = { action: 'opened' };
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  return {
    params: { provider: 'generic' },
    headers: {},
    body,
    rawBody,
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request & { rawBody?: Buffer };
}

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function sign(rawBody: Buffer, timestamp: number, secret = SECRET): string {
  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  return 'sha256=' + createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

beforeEach(() => {
  _resetIdempotencyStore();
  resetWebhookConfig();
  setWebhookConfig({
    github: { secrets: [SECRET], toleranceSeconds: 300 },
    stripe: { secrets: [SECRET], toleranceSeconds: 300 },
    generic: { secrets: [SECRET], toleranceSeconds: 300 },
  });
  jest.clearAllMocks();
});

// ── Signature verification ────────────────────────────────────────────────────

describe('handleWebhook — signature verification', () => {
  it('accepts a valid HMAC-signed generic webhook', () => {
    const rawBody = Buffer.from('{"action":"opened"}', 'utf8');
    const sig = sign(rawBody, NOW);
    const req = makeReq({
      rawBody,
      headers: {
        'x-webhook-signature': sig,
        'x-webhook-timestamp': String(NOW),
        'x-webhook-id': 'evt-001',
        'x-webhook-event': 'push',
      },
    });
    const res = makeRes();
    handleWebhook(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'accepted' });
    expect(webhookQueue.add).toHaveBeenCalledTimes(1);
  });

  it('rejects a webhook with an invalid signature', () => {
    const rawBody = Buffer.from('{"action":"opened"}', 'utf8');
    const req = makeReq({
      rawBody,
      headers: {
        'x-webhook-signature': 'sha256=badhash',
        'x-webhook-timestamp': String(NOW),
      },
    });
    const res = makeRes();
    handleWebhook(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(webhookQueue.add).not.toHaveBeenCalled();
  });

  it('rejects a replay attack (timestamp outside tolerance)', () => {
    const staleTs = NOW - 400; // > 300 s tolerance
    const rawBody = Buffer.from('{}', 'utf8');
    const sig = sign(rawBody, staleTs);
    const req = makeReq({
      rawBody,
      headers: {
        'x-webhook-signature': sig,
        'x-webhook-timestamp': String(staleTs),
      },
    });
    const res = makeRes();
    handleWebhook(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'replay' });
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('handleWebhook — idempotency', () => {
  it('returns duplicate status without re-enqueueing on second delivery', () => {
    const rawBody = Buffer.from('{}', 'utf8');
    const sig = sign(rawBody, NOW);
    const headers = {
      'x-webhook-signature': sig,
      'x-webhook-timestamp': String(NOW),
      'x-webhook-id': 'dup-key-1',
      'x-webhook-event': 'push',
    };

    const req1 = makeReq({ rawBody, headers });
    const req2 = makeReq({ rawBody, headers });
    const res1 = makeRes();
    const res2 = makeRes();

    handleWebhook(req1, res1, jest.fn());
    handleWebhook(req2, res2, jest.fn());

    expect(res1.json).toHaveBeenCalledWith({ status: 'accepted' });
    expect(res2.json).toHaveBeenCalledWith({ status: 'duplicate' });
    expect(webhookQueue.add).toHaveBeenCalledTimes(1);
  });
});

// ── Unknown provider ──────────────────────────────────────────────────────────

describe('handleWebhook — unknown provider', () => {
  it('returns 404 for unsupported provider', () => {
    const req = makeReq({ params: { provider: 'paypal' } });
    const res = makeRes();
    handleWebhook(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── IP allowlist ──────────────────────────────────────────────────────────────

describe('handleWebhook — IP allowlist', () => {
  it('blocks requests from IPs not in the allowlist', () => {
    setWebhookConfig({
      github: { secrets: [SECRET] },
      stripe: { secrets: [SECRET] },
      generic: { secrets: [SECRET], ipAllowlist: ['10.0.0.1'] },
    });
    const rawBody = Buffer.from('{}', 'utf8');
    const sig = sign(rawBody, NOW);
    const req = makeReq({
      rawBody,
      headers: { 'x-webhook-signature': sig, 'x-webhook-timestamp': String(NOW) },
      socket: { remoteAddress: '1.2.3.4' } as never,
    });
    const res = makeRes();
    handleWebhook(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

describe('getDeliveryHistoryHandler', () => {
  it('returns delivery records from queue', async () => {
    const records = [{ jobId: '1', provider: 'github', status: 'completed' }];
    (getDeliveryHistory as jest.Mock).mockResolvedValue(records);
    const req = { query: {} } as unknown as Request;
    const res = makeRes();
    await getDeliveryHistoryHandler(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(records);
  });
});

describe('retryDeliveryHandler', () => {
  it('calls retryFailedJob with the jobId param', async () => {
    (retryFailedJob as jest.Mock).mockResolvedValue(undefined);
    const req = { params: { jobId: 'job-42' } } as unknown as Request;
    const res = makeRes();
    await retryDeliveryHandler(req, res, jest.fn());
    expect(retryFailedJob).toHaveBeenCalledWith('job-42');
    expect(res.json).toHaveBeenCalledWith({ status: 'retried' });
  });

  it('calls next(err) when job is not found', async () => {
    const err = new Error('Job not found');
    (retryFailedJob as jest.Mock).mockRejectedValue(err);
    const req = { params: { jobId: 'missing' } } as unknown as Request;
    const res = makeRes();
    const next = jest.fn();
    await retryDeliveryHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
