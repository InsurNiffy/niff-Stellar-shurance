import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RampTransaction, RampProviderHealth, RampDirection, RampStatus } from '@prisma/client';

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export interface RampWebhookPayload {
  id?: string;
  transaction_id?: string;
  external_id?: string;
  status?: string;
  amount?: string;
  asset_code?: string;
  purchase_id?: string;
  [key: string]: unknown;
}

@Injectable()
export class RampService {
  private readonly logger = new Logger(RampService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  private isEnabled(): boolean {
    return this.config.get<string>('FEATURE_FIAT_RAMP') === 'true';
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new BadRequestException('Fiat on/off-ramp is not enabled');
    }
  }

  private getAnchorUrl(): string {
    return this.config.get<string>('SEP24_ANCHOR_URL') ?? '';
  }

  private getWebhookSecret(): string {
    return this.config.get<string>('RAMP_WEBHOOK_SECRET') ?? '';
  }

  /**
   * Verify the provider HMAC signature over the raw request body.
   * Throws UnauthorizedException (401) when the signature is missing or invalid.
   */
  verifyWebhookSignature(rawBody: string | Buffer, signature?: string): void {
    const secret = this.getWebhookSecret();
    if (!secret || !signature) {
      throw new UnauthorizedException('Missing ramp webhook signature');
    }

    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const provided = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;

    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new UnauthorizedException('Invalid ramp webhook signature');
    }
  }

  /**
   * Handle an incoming provider webhook: verify signature, then persist/update the RampTransaction.
   */
  async handleWebhook(
    rawBody: string | Buffer,
    signature: string | undefined,
    payload: RampWebhookPayload,
  ): Promise<RampTransaction> {
    this.verifyWebhookSignature(rawBody, signature);

    const externalId = payload.external_id ?? payload.transaction_id ?? payload.id;
    const mapped = payload.status ? this.mapAnchorStatus(payload.status) : null;

    if (externalId) {
      const existing = await this.prisma.rampTransaction.findFirst({ where: { externalId } });
      if (existing) {
        return this.prisma.rampTransaction.update({
          where: { id: existing.id },
          data: {
            status: mapped ?? existing.status,
            completedAt: mapped === RampStatus.COMPLETED ? new Date() : existing.completedAt,
          },
        });
      }
    }

    const provider = await this.getHealthyProvider();
    const created = await this.prisma.rampTransaction.create({
      data: {
        userId: (payload.user_id as string) ?? '',
        providerId: provider?.id ?? '',
        direction: RampDirection.DEPOSIT,
        assetCode: payload.asset_code ?? 'USDC',
        amount: payload.amount ?? null,
        externalId: externalId ?? null,
        status: mapped ?? RampStatus.PENDING,
        completedAt: mapped === RampStatus.COMPLETED ? new Date() : null,
      },
    });

    return created;
  }

  /**
   * Start an interactive SEP-24 deposit flow and return the anchor's interactive URL.
   */
  async deposit(userId: string, assetCode: string, amount?: string): Promise<{ interactiveUrl: string; transaction: RampTransaction }> {
    return this.startFlow(userId, RampDirection.DEPOSIT, assetCode, amount);
  }

  /**
   * Start an interactive SEP-24 withdraw flow and return the anchor's interactive URL.
   */
  async withdraw(userId: string, assetCode: string, amount?: string): Promise<{ interactiveUrl: string; transaction: RampTransaction }> {
    return this.startFlow(userId, RampDirection.WITHDRAW, assetCode, amount);
  }

  private async startFlow(
    userId: string,
    direction: RampDirection,
    assetCode: string,
    amount?: string,
  ): Promise<{ interactiveUrl: string; transaction: RampTransaction }> {
    this.assertEnabled();

    const provider = await this.getHealthyProvider();
    if (!provider) {
      throw new NotFoundException('No healthy ramp provider available');
    }

    const transaction = await this.prisma.rampTransaction.create({
      data: {
        userId,
        providerId: provider.id,
        direction,
        assetCode,
        amount: amount ?? null,
        status: RampStatus.PENDING,
      },
    });

    const interactiveUrl = await this.requestInteractiveUrl(provider, transaction, direction);

    const updated = await this.prisma.rampTransaction.update({
      where: { id: transaction.id },
      data: { interactiveUrl, status: RampStatus.PENDING_ANCHOR },
    });

    return { interactiveUrl, transaction: updated };
  }

  private async requestInteractiveUrl(
    provider: RampProviderHealth,
    transaction: RampTransaction,
    direction: RampDirection,
  ): Promise<string> {
    const baseUrl = provider.baseUrl || this.getAnchorUrl();
    const endpoint = direction === RampDirection.DEPOSIT ? '/sep24/transactions/deposit/interactive' : '/sep24/transactions/withdraw/interactive';

    try {
      const { data } = await firstValueFrom(
        this.http.post(`${baseUrl}${endpoint}`, {
          asset_code: transaction.assetCode,
          amount: transaction.amount,
          account: transaction.userId,
        }),
      );
      return data.url;
    } catch (err) {
      this.logger.error(`Failed to start ${direction} flow: ${(err as Error).message}`);
      await this.prisma.rampTransaction.update({
        where: { id: transaction.id },
        data: { status: RampStatus.FAILED },
      });
      throw new BadRequestException('Failed to start ramp flow with anchor');
    }
  }

  /**
   * Callback handler invoked by the anchor (or poller) to update a RampTransaction status.
   */
  async handleStatusUpdate(transactionId: string, status: RampStatus, externalId?: string): Promise<RampTransaction> {
    const transaction = await this.prisma.rampTransaction.findUnique({ where: { id: transactionId } });
    if (!transaction) {
      throw new NotFoundException('Ramp transaction not found');
    }

    return this.prisma.rampTransaction.update({
      where: { id: transactionId },
      data: {
        status,
        externalId: externalId ?? transaction.externalId,
        completedAt: status === RampStatus.COMPLETED ? new Date() : transaction.completedAt,
      },
    });
  }

  /**
   * Poller that reconciles pending transactions against the anchor's status endpoint.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollTransactionStatuses(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const pending = await this.prisma.rampTransaction.findMany({
      where: { status: { in: [RampStatus.PENDING, RampStatus.PENDING_ANCHOR] } },
    });

    for (const transaction of pending) {
      try {
        const provider = await this.prisma.rampProviderHealth.findUnique({ where: { id: transaction.providerId } });
        if (!provider) {
          continue;
        }
        const baseUrl = provider.baseUrl || this.getAnchorUrl();
        const { data } = await firstValueFrom(
          this.http.get(`${baseUrl}/sep24/transaction?id=${transaction.externalId ?? transaction.id}`),
        );
        const mapped = this.mapAnchorStatus(data.status);
        if (mapped && mapped !== transaction.status) {
          await this.handleStatusUpdate(transaction.id, mapped, data.id);
        }
      } catch (err) {
        this.logger.warn(`Status poll failed for ${transaction.id}: ${(err as Error).message}`);
      }
    }
  }

  private mapAnchorStatus(anchorStatus: string): RampStatus | null {
    switch (anchorStatus) {
      case 'pending_user_transfer_start':
      case 'pending_anchor':
        return RampStatus.PENDING_ANCHOR;
      case 'completed':
        return RampStatus.COMPLETED;
      case 'error':
      case 'failed':
        return RampStatus.FAILED;
      case 'refunded':
        return RampStatus.REFUNDED;
      default:
        return null;
    }
  }

  /**
   * Health-check job that probes each provider and toggles its healthy flag.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkProviderHealth(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const providers = await this.prisma.rampProviderHealth.findMany();
    for (const provider of providers) {
      const baseUrl = provider.baseUrl || this.getAnchorUrl();
      let healthy = false;
      try {
        const { data } = await firstValueFrom(this.http.get(`${baseUrl}/sep24/info`));
        healthy = !!data;
      } catch (err) {
        this.logger.warn(`Provider ${provider.id} health check failed: ${(err as Error).message}`);
      }

      await this.prisma.rampProviderHealth.update({
        where: { id: provider.id },
        data: { healthy, lastCheckedAt: new Date() },
      });
    }
  }

  /**
   * Returns a healthy provider, hiding unhealthy ones from selection.
   */
  async getHealthyProvider(): Promise<RampProviderHealth | null> {
    return this.prisma.rampProviderHealth.findFirst({
      where: { healthy: true },
      orderBy: { lastCheckedAt: 'desc' },
    });
  }

  /**
   * Readiness probe: reports whether at least one ramp provider is healthy.
   */
  async getReadiness(): Promise<{ enabled: boolean; healthy: boolean; lastCheckedAt: Date | null }> {
    if (!this.isEnabled()) {
      return { enabled: false, healthy: true, lastCheckedAt: null };
    }

    const provider = await this.prisma.rampProviderHealth.findFirst({
      orderBy: { lastCheckedAt: 'desc' },
    });

    return {
      enabled: true,
      healthy: provider?.healthy ?? false,
      lastCheckedAt: provider?.lastCheckedAt ?? null,
    };
  }

  /**
   * Reconciliation job that flags transactions stuck longer than the threshold.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcileStuckTransactions(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuck = await this.prisma.rampTransaction.findMany({
      where: {
        status: { in: [RampStatus.PENDING, RampStatus.PENDING_ANCHOR] },
        createdAt: { lt: cutoff },
        stuck: false,
      },
    });

    for (const transaction of stuck) {
      await this.prisma.rampTransaction.update({
        where: { id: transaction.id },
        data: { stuck: true, stuckFlaggedAt: new Date() },
      });
      this.logger.warn(`Ramp transaction ${transaction.id} flagged as stuck`);
    }
  }

  /**
   * Reconciliation: match completed RampTransactions against PolicyRenewal rows.
   * Marks matching renewals as paid and links the ramp transaction.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcileCompletedTransactions(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const completed = await this.prisma.rampTransaction.findMany({
      where: { status: RampStatus.COMPLETED, reconciledAt: null },
    });

    for (const transaction of completed) {
      try {
        const renewal = await this.prisma.policyRenewal.findFirst({
          where: {
            userId: transaction.userId,
            status: 'PENDING',
          },
          orderBy: { createdAt: 'asc' },
        });

        if (!renewal) {
          continue;
        }

        await this.prisma.policyRenewal.update({
          where: { id: renewal.id },
          data: { status: 'PAID', paidAt: new Date(), rampTransactionId: transaction.id },
        });

        await this.prisma.rampTransaction.update({
          where: { id: transaction.id },
          data: { reconciledAt: new Date() },
        });

        this.logger.log(`Reconciled ramp transaction ${transaction.id} to renewal ${renewal.id}`);
      } catch (err) {
        this.logger.warn(`Reconciliation failed for ${transaction.id}: ${(err as Error).message}`);
      }
    }
  }
}
