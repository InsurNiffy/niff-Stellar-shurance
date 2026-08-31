import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { FaqItem, SupportTicket } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CaptchaService } from './captcha.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { CreateFaqItemDto, UpdateFaqItemDto, ReorderFaqItemsDto } from './dto/faq.dto';
import { SupportTicketAutocloseService } from '../maintenance/support-ticket-autoclose.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly captcha: CaptchaService,
    private readonly config: ConfigService,
    private readonly autocloseService?: SupportTicketAutocloseService,
  ) {}

  async submitTicket(dto: CreateTicketDto, remoteIp?: string) {
    const valid = await this.captcha.verify(dto.captchaToken, remoteIp);
    if (!valid) {
      throw new BadRequestException('CAPTCHA verification failed');
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        email: dto.email.toLowerCase(),
        subject: dto.subject,
        message: dto.message,
        ipHash: remoteIp ? this.hashIp(remoteIp) : null,
      },
    });

    await this.notifyWebhook(ticket);

    this.logger.log(`Support ticket created: ${ticket.id}`);
    return this.mapToResponse(ticket);
  }

  async addCustomerReply(ticketId: string, message: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new BadRequestException(`Ticket ${ticketId} not found`);
    }

    const reply = await this.prisma.supportTicketReply.create({
      data: {
        ticketId,
        message,
        author: 'customer',
      },
    });

    // Reopen ticket if it was closed due to inactivity
    if (this.autocloseService) {
      await this.autocloseService.reopenIfReply(ticketId);
    }

    this.logger.log(`Customer reply added to ticket ${ticketId}`);
    return reply;
  }

  async updateTicketStatus(ticketId: string, dto: UpdateTicketStatusDto, actor: string, ipAddress?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new BadRequestException(`Ticket ${ticketId} not found`);
    }

    const now = new Date();
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: dto.status,
        updatedAt: now,
        // Record first staff response timestamp once, never overwrite.
        ...(ticket.firstRespondedAt == null ? { firstRespondedAt: now } : {}),
      },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        actor,
        action: 'support_ticket_status_updated',
        payload: {
          ticketId,
          from: ticket.status,
          to: dto.status,
          notes: dto.internalNotes ?? null,
          timestamp: new Date().toISOString(),
        },
        ipAddress,
      },
    });

    this.logger.log(`Support ticket ${ticketId} status updated from ${ticket.status} to ${dto.status}`);
    return this.mapToResponse(updated);
  }

  async assignTicket(ticketId: string, assignee: string | null, actor: string, ipAddress?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new BadRequestException(`Ticket ${ticketId} not found`);
    }

    const prevAssignee = ticket.assignedTo;
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { assignedTo: assignee, updatedAt: new Date() },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        actor,
        action: 'support_ticket_assigned',
        payload: {
          ticketId,
          from: prevAssignee,
          to: assignee,
          timestamp: new Date().toISOString(),
        },
        ipAddress,
      },
    });

    this.logger.log(`Support ticket ${ticketId} assigned to ${assignee ?? 'unassigned'}`);
    return this.mapToResponse(updated);
  }

  async getTicket(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new BadRequestException(`Ticket ${ticketId} not found`);
    }
    return this.mapToResponse(ticket);
  }

  async listTickets(limit = 50, offset = 0, assignedTo?: string | null) {
    const where = assignedTo !== undefined ? { assignedTo: assignedTo || undefined } : {};
    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets: tickets.map((ticket) => this.mapToResponse(ticket)),
      total,
    };
  }

  async trackFaqExpansion(faqId: string) {
    // Privacy-safe: only increment a counter, no user data stored
    await this.prisma.faqStat.upsert({
      where: { faqId },
      update: { expansions: { increment: 1 } },
      create: { faqId, expansions: 1 },
    });
  }

  async listFaqItems(): Promise<FaqItem[]> {
    return this.prisma.faqItem.findMany({
      orderBy: { displayOrder: 'asc' },
    });
  }

  async createFaqItem(dto: CreateFaqItemDto): Promise<FaqItem> {
    const maxOrder = await this.prisma.faqItem.aggregate({ _max: { displayOrder: true } });
    const nextOrder = (maxOrder._max.displayOrder ?? -1) + 1;
    return this.prisma.faqItem.create({
      data: {
        question: dto.question,
        answer: dto.answer,
        category: dto.category ?? 'General',
        displayOrder: dto.displayOrder ?? nextOrder,
      },
    });
  }

  async updateFaqItem(id: string, dto: UpdateFaqItemDto): Promise<FaqItem> {
    const existing = await this.prisma.faqItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`FAQ item ${id} not found`);
    return this.prisma.faqItem.update({ where: { id }, data: dto });
  }

  async deleteFaqItem(id: string): Promise<void> {
    const existing = await this.prisma.faqItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`FAQ item ${id} not found`);
    await this.prisma.faqItem.delete({ where: { id } });
  }

  async reorderFaqItems(dto: ReorderFaqItemsDto): Promise<FaqItem[]> {
    await this.prisma.$transaction(
      dto.items.map((entry) =>
        this.prisma.faqItem.update({
          where: { id: entry.id },
          data: { displayOrder: entry.displayOrder },
        }),
      ),
    );
    return this.listFaqItems();
  }

  private async notifyWebhook(ticket: { id: string; email: string; subject: string; message: string; createdAt: Date }) {
    const webhookUrl = this.config.get<string>('SUPPORT_WEBHOOK_URL', '');
    if (!webhookUrl) {
      this.logger.debug('Support webhook URL not configured, skipping notification');
      return;
    }

    const payload = {
      event: 'support_ticket_created',
      ticketId: ticket.id,
      email: ticket.email,
      subject: ticket.subject,
      message: ticket.message,
      createdAt: ticket.createdAt.toISOString(),
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn(`Support webhook returned ${response.status}`);
      }
    } catch (error) {
      this.logger.error(`Support webhook error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip + this.config.get<string>('IP_HASH_SALT', 'niff-salt'))
      .digest('hex');
  }

  async getFirstResponseStats(slaHours = 24) {
    const slaDeadline = new Date(Date.now() - slaHours * 60 * 60 * 1000);

    const [allResponded, slaBreached] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { firstRespondedAt: { not: null } },
        select: { createdAt: true, firstRespondedAt: true },
      }),
      this.prisma.supportTicket.count({
        where: {
          firstRespondedAt: null,
          status: 'OPEN',
          createdAt: { lt: slaDeadline },
        },
      }),
    ]);

    const totalResponded = allResponded.length;
    const avgFirstResponseMs =
      totalResponded > 0
        ? allResponded.reduce((sum, t) => {
            const ms = t.firstRespondedAt!.getTime() - t.createdAt.getTime();
            return sum + ms;
          }, 0) / totalResponded
        : null;

    return {
      totalResponded,
      avgFirstResponseMs,
      avgFirstResponseHours: avgFirstResponseMs != null ? avgFirstResponseMs / (1000 * 60 * 60) : null,
      slaBreachedCount: slaBreached,
      slaHours,
    };
  }

  private mapToResponse(ticket: SupportTicket) {
    return {
      id: ticket.id,
      email: ticket.email,
      subject: ticket.subject,
      message: ticket.message,
      status: ticket.status,
      assignedTo: ticket.assignedTo ?? null,
      ipHash: ticket.ipHash ?? '',
      firstRespondedAt: ticket.firstRespondedAt ?? null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }
}
