import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OutboundWebhookService } from './outbound-webhook.service';
import { outboundWebhookQueue } from './outbound.queue';

jest.mock('./outbound.queue', () => ({
  outboundWebhookQueue: {
    add: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockAdd = outboundWebhookQueue.add as jest.Mock;

describe('OutboundWebhookService', () => {
  let service: OutboundWebhookService;
  let configValues: Record<string, string>;

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues = {
      CLAIM_FILED_WEBHOOK_URLS: '',
      VOTE_CAST_WEBHOOK_URLS: '',
      TREASURY_ALERT_WEBHOOK_URLS: '',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboundWebhookService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def = '') =>
              Object.prototype.hasOwnProperty.call(configValues, key)
                ? configValues[key as keyof typeof configValues]
                : def,
          },
        },
      ],
    }).compile();

    service = module.get(OutboundWebhookService);
  });

  describe('getSubscriberUrls', () => {
    it('returns empty array when env var is not set', () => {
      expect(service.getSubscriberUrls('CLAIM_FILED_WEBHOOK_URLS')).toEqual([]);
    });

    it('parses comma-separated URLs', () => {
      configValues.CLAIM_FILED_WEBHOOK_URLS = 'https://a.example/h,https://b.example/h';
      expect(service.getSubscriberUrls('CLAIM_FILED_WEBHOOK_URLS')).toEqual([
        'https://a.example/h',
        'https://b.example/h',
      ]);
    });

    it('trims whitespace around URLs', () => {
      configValues.CLAIM_FILED_WEBHOOK_URLS = ' https://a.example/h , https://b.example/h ';
      expect(service.getSubscriberUrls('CLAIM_FILED_WEBHOOK_URLS')).toEqual([
        'https://a.example/h',
        'https://b.example/h',
      ]);
    });
  });

  describe('deliverClaimFiled (#891)', () => {
    it('does nothing when no subscribers are configured', async () => {
      await service.deliverClaimFiled({ claimId: 1 }, 'key-1');
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('enqueues one job per subscriber URL', async () => {
      configValues.CLAIM_FILED_WEBHOOK_URLS =
        'https://subs1.example/hook,https://subs2.example/hook';
      const payload = { claimId: 42, status: 'PENDING' };

      await service.deliverClaimFiled(payload, 'claim_filed:txhash123');

      expect(mockAdd).toHaveBeenCalledTimes(2);
      expect(mockAdd).toHaveBeenCalledWith(
        'claim.filed',
        expect.objectContaining({
          targetUrl: 'https://subs1.example/hook',
          eventType: 'claim.filed',
          payload,
        }),
      );
      expect(mockAdd).toHaveBeenCalledWith(
        'claim.filed',
        expect.objectContaining({
          targetUrl: 'https://subs2.example/hook',
          eventType: 'claim.filed',
          payload,
        }),
      );
    });
  });

  describe('deliverVoteCast (#892)', () => {
    it('does nothing when no subscribers are configured', async () => {
      await service.deliverVoteCast({ claimId: 1 }, 'key-2');
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('enqueues a job for each registered vote.cast subscriber', async () => {
      configValues.VOTE_CAST_WEBHOOK_URLS = 'https://gov.example/vote-hook';
      const payload = { claimId: 7, voter: 'GADDR', vote: 'Approve' };

      await service.deliverVoteCast(payload, 'vote_cast:txhash:7:GADDR');

      expect(mockAdd).toHaveBeenCalledTimes(1);
      expect(mockAdd).toHaveBeenCalledWith(
        'vote.cast',
        expect.objectContaining({
          targetUrl: 'https://gov.example/vote-hook',
          eventType: 'vote.cast',
          payload,
        }),
      );
    });
  });

  describe('deliverTreasuryAlert (#893)', () => {
    it('does nothing when no URLs are configured', async () => {
      await service.deliverTreasuryAlert({ bufferStroops: '0' }, 'alert-key');
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('enqueues treasury.balance_low for each alert endpoint', async () => {
      configValues.TREASURY_ALERT_WEBHOOK_URLS =
        'https://alerts.example/treasury,https://ops.example/treasury';
      const payload = { bufferStroops: '50', thresholdStroops: '100' };

      await service.deliverTreasuryAlert(payload, 'treasury_alert:ts');

      expect(mockAdd).toHaveBeenCalledTimes(2);
      expect(mockAdd).toHaveBeenCalledWith(
        'treasury.balance_low',
        expect.objectContaining({
          eventType: 'treasury.balance_low',
          payload,
        }),
      );
    });
  });
});
