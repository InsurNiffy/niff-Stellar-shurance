import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
} from './dto/webhook-subscription.dto';
import {
  assertSafeWebhookUrlResolved,
  defaultDnsLookup,
  DnsLookupFn,
  SsrfBlockedError,
} from './ssrf';

/** Injection token so tests can substitute a deterministic DNS lookup. */
export const WEBHOOK_DNS_LOOKUP = 'WEBHOOK_DNS_LOOKUP';

void defaultDnsLookup;

@Injectable()
export class WebhookSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WEBHOOK_DNS_LOOKUP) private readonly lookup: DnsLookupFn,
  ) {}

  /** Validates the target URL (SSRF) and maps SSRF rejections to 400s. */
  private async assertUrlIsSafe(url: string): Promise<void> {
    try {
      await assertSafeWebhookUrlResolved(url, this.lookup);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new BadRequestException({ message: err.message, code: 'SSRF_BLOCKED' });
      }
      throw err;
    }
  }

  async create(dto: CreateWebhookSubscriptionDto, tenantId?: string) {
    await this.assertUrlIsSafe(dto.url);
    const secret = dto.secret ?? randomBytes(32).toString('hex');
    return this.prisma.webhookSubscription.create({
      data: {
        url: dto.url,
        events: dto.events,
        secret,
        tenantId: tenantId ?? null,
      },
    });
  }

  async list(tenantId?: string) {
    return this.prisma.webhookSubscription.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const subscription = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!subscription) throw new NotFoundException(`Webhook subscription ${id} not found`);
    return subscription;
  }

  async update(id: string, dto: UpdateWebhookSubscriptionDto) {
    await this.get(id);
    if (dto.url) await this.assertUrlIsSafe(dto.url);
    return this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { deleted: true, id };
  }

  /** Active subscriptions interested in `eventType`. */
  async findSubscribers(eventType: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { active: true, events: { has: eventType } },
    });
  }
}
