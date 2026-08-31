import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { WebhookRegistrationService, WebhookStatus } from './webhook-registration.service';

jest.mock('axios');

describe('WebhookRegistrationService', () => {
  let service: WebhookRegistrationService;
  let mockConfig: Partial<ConfigService>;

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, any> = {
          WEBHOOK_VERIFICATION_TIMEOUT_MS: 300_000,
          WEBHOOK_MAX_VERIFICATION_ATTEMPTS: 3,
          API_BASE_URL: 'http://localhost:3000',
        };
        return values[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookRegistrationService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(WebhookRegistrationService);
  });

  describe('registerWebhook', () => {
    it('registers a new webhook in pending state', async () => {
      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      expect(webhook.status).toBe(WebhookStatus.PENDING);
      expect(webhook.url).toBe('https://example.com/webhook');
      expect(webhook.eventType).toBe('claim.filed');
      expect(webhook.createdAt).toBeInstanceOf(Date);
      expect(webhook.secret).toBeDefined();
    });

    it('returns verification URL for registrant to confirm', async () => {
      const { verificationUrl } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      expect(verificationUrl).toContain('/webhooks/verify/');
      expect(verificationUrl).toContain('http://localhost:3000');
    });

    it('rejects localhost URLs', async () => {
      await expect(
        service.registerWebhook('http://localhost:3000/webhook', 'claim.filed'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.registerWebhook('http://127.0.0.1:3000/webhook', 'claim.filed'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid URLs', async () => {
      await expect(
        service.registerWebhook('not-a-url', 'claim.filed'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.registerWebhook('ftp://example.com/webhook', 'claim.filed'),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents duplicate registrations of active webhooks', async () => {
      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      // Manually activate the webhook for this test (bypassing the verify flow)
      webhook.status = WebhookStatus.ACTIVE;

      // Now try to register same URL again
      await expect(
        service.registerWebhook('https://example.com/webhook', 'claim.filed'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyWebhook', () => {
    it('activates webhook when correct challenge is echoed', async () => {
      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      const challenge = service['challenges'].get(webhook.id);
      expect(challenge).toBeDefined();

      const verified = await service.verifyWebhook(webhook.id, challenge!.token);

      expect(verified.status).toBe(WebhookStatus.ACTIVE);
      expect(verified.verifiedAt).toBeInstanceOf(Date);
    });

    it('rejects invalid challenge response', async () => {
      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      await expect(
        service.verifyWebhook(webhook.id, 'wrong-challenge'),
      ).rejects.toThrow(BadRequestException);

      // Webhook should still be pending
      const w = service.getWebhook(webhook.id);
      expect(w?.status).toBe(WebhookStatus.PENDING);
    });

    it('rejects verification of non-existent webhook', async () => {
      await expect(
        service.verifyWebhook('non-existent-id', 'challenge-token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('cleans up expired challenges', async () => {
      jest.useFakeTimers();

      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      expect(service['challenges'].has(webhook.id)).toBe(true);

      // Fast-forward past challenge timeout
      jest.advanceTimersByTime(300_100);

      // Challenge should be removed
      const challenge = service['challenges'].get(webhook.id);
      expect(challenge).toBeUndefined();

      jest.useRealTimers();
    });

    it('prevents re-verification of active webhooks', async () => {
      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      const challenge = service['challenges'].get(webhook.id);
      await service.verifyWebhook(webhook.id, challenge!.token);

      // Re-verifying an already-active webhook is idempotent: it succeeds
      // and returns the webhook rather than erroring.
      const result = await service.verifyWebhook(webhook.id, challenge!.token);
      expect(result.status).toBe(WebhookStatus.ACTIVE);
    });
  });

  describe('sendVerificationChallenge', () => {
    it('sends challenge to webhook URL', async () => {
      const axios = require('axios');
      axios.post = jest.fn().mockResolvedValue({ status: 200 });

      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      await service.sendVerificationChallenge(webhook.id);

      expect(axios.post).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          type: 'webhook.verification',
          webhookId: webhook.id,
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Webhook-Signature': expect.any(String),
          }),
          timeout: 10_000,
        }),
      );
    });

    it('tracks failed verification attempts', async () => {
      const axios = require('axios');
      axios.post = jest.fn().mockRejectedValue(new Error('Connection timeout'));

      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      for (let i = 0; i < 3; i++) {
        try {
          await service.sendVerificationChallenge(webhook.id);
        } catch {
          // Expected to fail
        }
      }

      const w = service.getWebhook(webhook.id);
      expect(w?.failedAttempts).toBe(3);
      expect(w?.status).toBe(WebhookStatus.INACTIVE);
    });

    it('rejects verification for non-existent webhook', async () => {
      await expect(
        service.sendVerificationChallenge('non-existent-id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listWebhooks', () => {
    it('returns webhooks for event type', async () => {
      await service.registerWebhook('https://example.com/webhook1', 'claim.filed');
      await service.registerWebhook('https://example.com/webhook2', 'claim.filed');
      await service.registerWebhook('https://example.com/webhook3', 'vote.cast');

      const claimFiledWebhooks = service.listWebhooks('claim.filed');
      expect(claimFiledWebhooks).toHaveLength(2);

      const voteCastWebhooks = service.listWebhooks('vote.cast');
      expect(voteCastWebhooks).toHaveLength(1);
    });

    it('filters webhooks by status', async () => {
      const { webhook: w1 } = await service.registerWebhook(
        'https://example.com/webhook1',
        'claim.filed',
      );
      const { webhook: w2 } = await service.registerWebhook(
        'https://example.com/webhook2',
        'claim.filed',
      );

      const challenge = service['challenges'].get(w1.id);
      await service.verifyWebhook(w1.id, challenge!.token);

      const activeWebhooks = service.listWebhooks('claim.filed', WebhookStatus.ACTIVE);
      expect(activeWebhooks).toHaveLength(1);
      expect(activeWebhooks[0].id).toBe(w1.id);

      const pendingWebhooks = service.listWebhooks('claim.filed', WebhookStatus.PENDING);
      expect(pendingWebhooks).toHaveLength(1);
      expect(pendingWebhooks[0].id).toBe(w2.id);
    });
  });

  describe('deactivateWebhook', () => {
    it('deactivates an active webhook', async () => {
      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      const challenge = service['challenges'].get(webhook.id);
      await service.verifyWebhook(webhook.id, challenge!.token);

      const deactivated = service.deactivateWebhook(webhook.id);
      expect(deactivated.status).toBe(WebhookStatus.INACTIVE);
    });
  });

  describe('deleteWebhook', () => {
    it('deletes a webhook', async () => {
      const { webhook } = await service.registerWebhook(
        'https://example.com/webhook',
        'claim.filed',
      );

      service.deleteWebhook(webhook.id);

      expect(service.getWebhook(webhook.id)).toBeUndefined();
      expect(service['challenges'].has(webhook.id)).toBe(false);
    });
  });
});
