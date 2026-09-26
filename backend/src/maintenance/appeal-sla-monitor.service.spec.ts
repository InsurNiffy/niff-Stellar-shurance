import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  AppealSlaMonitorService,
  DEFAULT_APPEAL_SLA_GRACE_LEDGERS,
} from './appeal-sla-monitor.service';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn().mockResolvedValue({ status: 200 }) },
}));

jest.mock('../config/network.config', () => ({
  getNetworkConfig: () => ({
    contractIds: { niffyinsure: 'CDEMO' },
  }),
}));

const axiosPost = axios.post as jest.Mock;

describe('AppealSlaMonitorService', () => {
  let service: AppealSlaMonitorService;
  let prisma: { claim: { findMany: jest.Mock } };
  let soroban: {
    getLatestLedger: jest.Mock;
    simulateGetClaimsBatch: jest.Mock;
  };
  let config: Record<string, string | number>;

  beforeEach(async () => {
    jest.clearAllMocks();
    config = {
      APPEAL_SLA_MONITOR_ENABLED: 'true',
      APPEAL_SLA_GRACE_LEDGERS: String(DEFAULT_APPEAL_SLA_GRACE_LEDGERS),
      APPEAL_SLA_ALERT_WEBHOOK_URL: '',
      APPEAL_SLA_ALERT_WEBHOOK_SECRET: '',
    };

    prisma = {
      claim: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
    };
    soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(200_000),
      simulateGetClaimsBatch: jest.fn().mockResolvedValue([
        { appeal_deadline_ledger: 100_000 },
        { appeal_deadline_ledger: 190_000 },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppealSlaMonitorService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: string | number) =>
              Object.prototype.hasOwnProperty.call(config, key)
                ? config[key]
                : def,
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: SorobanService, useValue: soroban },
      ],
    }).compile();

    service = module.get(AppealSlaMonitorService);
  });

  it('alerts when UNDER_APPEAL claims are past deadline + grace', async () => {
    // current=200000, grace=17280 → threshold for claim1 = 100000+17280 = 117280 → stuck
    // claim2 deadline 190000 + 17280 = 207280 > 200000 → not stuck
    const result = await service.checkStuckAppeals();

    expect(result.underAppealChecked).toBe(2);
    expect(result.stuck).toHaveLength(1);
    expect(result.stuck[0].claimId).toBe(1);
    expect(result.stuck[0].appealDeadlineLedger).toBe(100_000);
    expect(result.alertEmitted).toBe(true);
  });

  it('does not alert when all appeals are within grace', async () => {
    soroban.getLatestLedger.mockResolvedValueOnce(100_500);
    soroban.simulateGetClaimsBatch.mockResolvedValueOnce([
      { appeal_deadline_ledger: 100_000 },
      { appeal_deadline_ledger: 100_200 },
    ]);

    const result = await service.checkStuckAppeals();
    expect(result.stuck).toHaveLength(0);
    expect(result.alertEmitted).toBe(false);
  });

  it('posts webhook when configured and stuck appeals found', async () => {
    config.APPEAL_SLA_ALERT_WEBHOOK_URL = 'https://hooks.example/appeal-sla';
    config.APPEAL_SLA_ALERT_WEBHOOK_SECRET = 'sekret';

    await service.checkStuckAppeals();

    expect(axiosPost).toHaveBeenCalledWith(
      'https://hooks.example/appeal-sla',
      expect.objectContaining({
        event: 'appeal_sla_breach',
        stuckCount: 1,
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Webhook-Secret': 'sekret' }),
      }),
    );
  });
});
