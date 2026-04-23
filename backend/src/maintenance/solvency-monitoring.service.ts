import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { RedisService } from '../cache/redis.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  SOLVENCY_SNAPSHOT_REDIS_KEY,
  SOLVENCY_SNAPSHOT_TTL_SECONDS,
} from './solvency.constants';

export type SolvencySnapshotStatus = 'ok' | 'degraded' | 'unknown';

export interface SolvencySnapshot {
  status: SolvencySnapshotStatus;
  checkedAt: string;
  thresholdStroops: string;
  contractBalanceStroops?: string;
  outstandingApprovedStroops?: string;
  bufferStroops?: string;
  alertEmitted: boolean;
  rpcError?: string;
  skipReason?: string;
}

@Injectable()
export class SolvencyMonitoringService {
  private readonly logger = new Logger(SolvencyMonitoringService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
    private readonly redis: RedisService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** Dashboard: last job snapshot only — no Soroban RPC. */
  async getLatestSnapshot(): Promise<SolvencySnapshot | null> {
    return this.redis.get<SolvencySnapshot>(SOLVENCY_SNAPSHOT_REDIS_KEY);
  }

  @Cron(process.env.SOLVENCY_CRON_EXPRESSION || '0 */15 * * * *')
  async runScheduledSolvencyCheck(): Promise<void> {
    await this.runSolvencyCheck();
  }

  /** Public for tests and manual triggers. */
  async runSolvencyCheck(): Promise<SolvencySnapshot> {
    const enabledRaw = this.config.get<string>('SOLVENCY_MONITORING_ENABLED', 'true');
    const enabled =
      enabledRaw === 'true' || enabledRaw === '1';
    const threshold = BigInt(
      this.config.get<string>('SOLVENCY_BUFFER_THRESHOLD_STROOPS', '0'),
    );

    if (!enabled) {
      const snap: SolvencySnapshot = {
        status: 'unknown',
        checkedAt: new Date().toISOString(),
        thresholdStroops: threshold.toString(),
        alertEmitted: false,
        skipReason: 'SOLVENCY_MONITORING_ENABLED=false',
      };
      await this.persistSnapshot(snap);
      return snap;
    }

    const contractId = this.config.get<string>('CONTRACT_ID', '');
    if (!contractId) {
      const snap: SolvencySnapshot = {
        status: 'unknown',
        checkedAt: new Date().toISOString(),
        thresholdStroops: threshold.toString(),
        alertEmitted: false,
        skipReason: 'CONTRACT_ID not configured',
      };
      await this.persistSnapshot(snap);
      this.logger.warn(
        JSON.stringify({
          event: 'solvency_check_skipped',
          reason: 'missing_contract_id',
        }),
      );
      return snap;
    }

    const source = this.config.get<string>('SOLVENCY_SIMULATION_SOURCE_ACCOUNT', '')?.trim();
    if (!source) {
      const snap: SolvencySnapshot = {
        status: 'unknown',
        checkedAt: new Date().toISOString(),
        thresholdStroops: threshold.toString(),
        alertEmitted: false,
        skipReason: 'SOLVENCY_SIMULATION_SOURCE_ACCOUNT not set',
      };
      await this.persistSnapshot(snap);
      this.logger.warn(
        JSON.stringify({
          event: 'solvency_unknown',
          reason: 'missing_simulation_source_account',
        }),
      );
      return snap;
    }

    let outstanding: bigint;
    try {
      outstanding = await this.sumApprovedUnpaidClaims();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const snap: SolvencySnapshot = {
        status: 'unknown',
        checkedAt: new Date().toISOString(),
        thresholdStroops: threshold.toString(),
        alertEmitted: false,
        rpcError: `db_aggregate_failed: ${msg}`,
      };
      await this.persistSnapshot(snap);
      this.logger.error(
        JSON.stringify({ event: 'solvency_unknown', phase: 'db', error: msg }),
      );
      return snap;
    }

    let balance: bigint;
    try {
      const sim = await this.soroban.simulateGetTreasuryBalance({
        sourceAccount: source,
      });
      balance = BigInt(sim.balanceStroops);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const snap: SolvencySnapshot = {
        status: 'unknown',
        checkedAt: new Date().toISOString(),
        thresholdStroops: threshold.toString(),
        outstandingApprovedStroops: outstanding.toString(),
        alertEmitted: false,
        rpcError: msg,
      };
      await this.persistSnapshot(snap);
      this.logger.warn(
        JSON.stringify({
          event: 'solvency_unknown',
          reason: 'rpc_or_simulation_failed',
          error: msg,
          outstandingApprovedStroops: outstanding.toString(),
        }),
      );
      return snap;
    }

    const buffer = balance - outstanding;
    this.metrics?.recordSolvencyThreshold({
      tenant: tenantFilter || 'default',
      thresholdStroops: threshold,
    });
    this.metrics?.recordSolvencyBuffer({
      tenant: tenantFilter || 'default',
      bufferStroops: buffer,
    });

    const below = buffer < threshold;

    const snap: SolvencySnapshot = {
      status: below ? 'degraded' : 'ok',
      checkedAt: new Date().toISOString(),
      thresholdStroops: threshold.toString(),
      contractBalanceStroops: balance.toString(),
      outstandingApprovedStroops: outstanding.toString(),
      bufferStroops: buffer.toString(),
      alertEmitted: below,
    };

    await this.persistSnapshot(snap);

    if (below) {
      this.logger.warn(
        JSON.stringify({
          event: 'solvency_buffer_low',
          severity: 'critical',
          bufferStroops: buffer.toString(),
          thresholdStroops: threshold.toString(),
          contractBalanceStroops: balance.toString(),
          outstandingApprovedStroops: outstanding.toString(),
        }),
      );
      await this.sendWebhookAlert(snap);
    } else {
      this.logger.log(
        JSON.stringify({
          event: 'solvency_ok',
          bufferStroops: buffer.toString(),
          thresholdStroops: threshold.toString(),
        }),
      );
    }

    return snap;
  }

  private async persistSnapshot(snap: SolvencySnapshot): Promise<void> {
    await this.redis.set(SOLVENCY_SNAPSHOT_REDIS_KEY, snap, SOLVENCY_SNAPSHOT_TTL_SECONDS);
  }

  private async sumApprovedUnpaidClaims(): Promise<bigint> {
    const tenantFilter = this.config.get<string>('SOLVENCY_TENANT_ID', '')?.trim();
    const rows = tenantFilter
      ? await this.prisma.$queryRaw<[{ s: string | null }]>(
          Prisma.sql`
            SELECT COALESCE(SUM(CAST(amount AS DECIMAL)), 0)::text AS s
            FROM claims
            WHERE status = 'APPROVED' AND "tenantId" = ${tenantFilter}
          `,
        )
      : await this.prisma.$queryRaw<[{ s: string | null }]>(
          Prisma.sql`
            SELECT COALESCE(SUM(CAST(amount AS DECIMAL)), 0)::text AS s
            FROM claims
            WHERE status = 'APPROVED'
          `,
        );
    const raw = rows[0]?.s ?? '0';
    return BigInt(raw.split('.')[0] || '0');
  }

  private async sendWebhookAlert(snapshot: SolvencySnapshot): Promise<void> {
    const webhookUrl = this.config.get<string>('SOLVENCY_ALERT_WEBHOOK_URL')?.trim();
    if (!webhookUrl) {
      this.logger.warn(
        '[solvency] SOLVENCY_ALERT_WEBHOOK_URL not set — buffer-low alert logged only',
      );
      return;
    }

    const { default: axios } = await import('axios');
    const secret = this.config.get<string>('SOLVENCY_ALERT_WEBHOOK_SECRET', '');
    try {
      await axios.post(
        webhookUrl,
        {
          event: 'solvency_buffer_low',
          severity: 'critical',
          checkedAt: snapshot.checkedAt,
          bufferStroops: snapshot.bufferStroops,
          thresholdStroops: snapshot.thresholdStroops,
          contractBalanceStroops: snapshot.contractBalanceStroops,
          outstandingApprovedStroops: snapshot.outstandingApprovedStroops,
        },
        {
          headers: secret ? { 'X-Webhook-Secret': secret } : undefined,
          timeout: 10_000,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[solvency] webhook delivery failed: ${msg}`);
    }
  }
}
