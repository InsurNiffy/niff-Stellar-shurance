import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanRpcService } from '../soroban/soroban-rpc.service';
import { Claim, ClaimStatus } from '../claims/entities/claim.entity';
import { RedisService } from '../redis/redis.service';

const SNAPSHOT_KEY = 'solvency:latest';
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_THRESHOLD = '0';

export type SolvencyState = 'healthy' | 'below_threshold' | 'solvency_unknown';

export interface SolvencySnapshot {
  state: SolvencyState;
  balance: string | null;
  outstanding: string;
  buffer: string | null;
  threshold: string;
  checkedAt: string;
  error?: string;
}

@Injectable()
export class SolvencyMonitorJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SolvencyMonitorJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly sorobanRpc: SorobanRpcService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    @InjectRepository(Claim)
    private readonly claimRepo: Repository<Claim>,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(
      this.config.get<string>('SOLVENCY_MONITOR_INTERVAL_MS') ?? DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(): Promise<SolvencySnapshot> {
    if (this.running) {
      return this.buildUnknown('previous run still in progress');
    }
    this.running = true;
    try {
      const snapshot = await this.checkSolvency();
      await this.storeSnapshot(snapshot);
      return snapshot;
    } finally {
      this.running = false;
    }
  }

  private async checkSolvency(): Promise<SolvencySnapshot> {
    const threshold = this.config.get<string>('SOLVENCY_ALERT_THRESHOLD') ?? DEFAULT_THRESHOLD;
    const checkedAt = new Date().toISOString();

    let outstanding: string;
    try {
      outstanding = await this.getOutstandingClaims();
    } catch (err) {
      return this.buildUnknown(this.errorMessage(err), threshold, checkedAt);
    }

    let balance: string;
    try {
      balance = await this.sorobanRpc.getTreasuryBalance();
    } catch (err) {
      return this.buildUnknown(this.errorMessage(err), threshold, checkedAt, outstanding);
    }

    const buffer = this.subtract(balance, outstanding);
    const belowThreshold = this.compare(buffer, threshold) < 0;
    const state: SolvencyState = belowThreshold ? 'below_threshold' : 'healthy';

    const snapshot: SolvencySnapshot = {
      state,
      balance,
      outstanding,
      buffer,
      threshold,
      checkedAt,
    };

    if (belowThreshold) {
      this.emitAlert(snapshot);
    }

    return snapshot;
  }

  private async getOutstandingClaims(): Promise<string> {
    const raw = await this.claimRepo
      .createQueryBuilder('claim')
      .select('COALESCE(SUM(claim.amount), 0)', 'total')
      .where('claim.status = :status', { status: ClaimStatus.APPROVED })
      .getRawOne<{ total: string }>();
    return this.normalize(raw?.total ?? '0');
  }

  private emitAlert(snapshot: SolvencySnapshot): void {
    const payload = {
      event: 'solvency_alert',
      state: snapshot.state,
      balance: snapshot.balance,
      outstanding: snapshot.outstanding,
      buffer: snapshot.buffer,
      threshold: snapshot.threshold,
      checkedAt: snapshot.checkedAt,
    };
    this.logger.warn(JSON.stringify(payload));

    const webhookUrl = this.config.get<string>('SOLVENCY_ALERT_WEBHOOK_URL');
    if (webhookUrl) {
      void fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch((err) => {
        this.logger.error(`solvency webhook delivery failed: ${this.errorMessage(err)}`);
      });
    }
  }

  private async storeSnapshot(snapshot: SolvencySnapshot): Promise<void> {
    try {
      await this.redis.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (err) {
      this.logger.error(`failed to store solvency snapshot: ${this.errorMessage(err)}`);
    }
  }

  private buildUnknown(
    error: string,
    threshold = this.config.get<string>('SOLVENCY_ALERT_THRESHOLD') ?? DEFAULT_THRESHOLD,
    checkedAt = new Date().toISOString(),
    outstanding = '0',
  ): SolvencySnapshot {
    const snapshot: SolvencySnapshot = {
      state: 'solvency_unknown',
      balance: null,
      outstanding,
      buffer: null,
      threshold,
      checkedAt,
      error,
    };
    this.logger.warn(JSON.stringify({ event: 'solvency_unknown', error, checkedAt }));
    return snapshot;
  }

  private normalize(value: string): string {
    const n = BigInt(value);
    return n.toString();
  }

  private subtract(a: string, b: string): string {
    return (BigInt(a) - BigInt(b)).toString();
  }

  private compare(a: string, b: string): number {
    const left = BigInt(a);
    const right = BigInt(b);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
