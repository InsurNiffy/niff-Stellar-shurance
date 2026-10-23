import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { getTransport } from '../notifications/notification.service';
import { config } from '../config/env';
import { WEBHOOK_DNS_LOOKUP } from './webhook-subscriptions.service';
import { assertSafeWebhookUrlResolved, DnsLookupFn } from './ssrf';

/**
 * Daily re-validation of active webhook subscription URLs (#1654).
 * Guards against DNS rebinding after creation: a URL that now resolves to a
 * private/blocked address is disabled, audited and its tenant notified.
 */
@Injectable()
export class WebhookSsrfRevalidationService {
  private readonly logger = new Logger(WebhookSsrfRevalidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WEBHOOK_DNS_LOOKUP) private readonly lookup: DnsLookupFn,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async revalidateAll(): Promise<{ checked: number; disabled: number }> {
    const subs = await this.prisma.webhookSubscription.findMany({ where: { active: true } });
    let disabled = 0;

    for (const sub of subs) {
      let reason: string | null = null;
      try {
        await assertSafeWebhookUrlResolved(sub.url, this.lookup);
      } catch (err) {
        reason = err instanceof Error ? err.message : String(err);
      }

      if (reason) {
        await this.prisma.webhookSubscription.update({
          where: { id: sub.id },
          data: { active: false },
        });
        disabled++;
        this.logger.warn(`[ssrf-revalidate] disabled subscription ${sub.id}: ${reason}`);
        await this.notifyTenant(sub.tenantId, sub.id, sub.url, reason);
      }

      await this.prisma.webhookSsrfAudit.create({
        data: { subscriptionId: sub.id, url: sub.url, passed: !reason, reason, disabled: !!reason },
      });
    }

    this.logger.log(`[ssrf-revalidate] checked ${subs.length}, disabled ${disabled}`);
    return { checked: subs.length, disabled };
  }

  private async notifyTenant(
    tenantId: string | null,
    subscriptionId: string,
    url: string,
    reason: string,
  ): Promise<void> {
    if (!tenantId) return;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.contactEmail) return;
    try {
      await getTransport().sendMail({
        from: config.smtp.from,
        to: tenant.contactEmail,
        subject: 'Webhook subscription disabled',
        text:
          `Your webhook subscription ${subscriptionId} (${url}) was disabled because ` +
          `it failed SSRF re-validation: ${reason}. Update the URL to re-enable it.`,
      });
    } catch (err) {
      this.logger.error(
        `[ssrf-revalidate] email to tenant ${tenantId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
