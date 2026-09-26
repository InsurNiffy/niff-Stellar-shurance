import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_AUTOCLOSE_DAYS_INACTIVE = 7;

@Injectable()
export class SupportTicketAutocloseService {
  private readonly logger = new Logger(SupportTicketAutocloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async autoCloseInactiveTickets(): Promise<number> {
    const daysInactive =
      this.config.get<number>('SUPPORT_TICKET_AUTOCLOSE_DAYS_INACTIVE') ||
      DEFAULT_AUTOCLOSE_DAYS_INACTIVE;

    const inactivityThreshold = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000);

    const ticketsToClose = await this.prisma.supportTicket.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        firstRespondedAt: { not: null },
        updatedAt: { lt: inactivityThreshold },
      },
    });

    if (ticketsToClose.length === 0) {
      this.logger.log(`[support-ticket-autoclose] no tickets to close`);
      return 0;
    }

    const now = new Date();
    const closed = await this.prisma.supportTicket.updateMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        firstRespondedAt: { not: null },
        updatedAt: { lt: inactivityThreshold },
      },
      data: {
        status: 'CLOSED',
        updatedAt: now,
      },
    });

    for (const ticket of ticketsToClose) {
      await this.prisma.adminAuditLog.create({
        data: {
          actor: 'system',
          action: 'support_ticket_autoclose',
          payload: {
            ticketId: ticket.id,
            reason: `No customer reply for ${daysInactive} days after staff response`,
            closedAt: now.toISOString(),
            inactivityThreshold: inactivityThreshold.toISOString(),
          },
        },
      });
    }

    this.logger.log(`[support-ticket-autoclose] closed ${closed.count} tickets due to inactivity`);
    return closed.count;
  }

  async reopenIfReply(ticketId: string): Promise<void> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return;

    if (ticket.status === 'CLOSED' && ticket.firstRespondedAt) {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: 'IN_PROGRESS',
          updatedAt: new Date(),
        },
      });

      await this.prisma.adminAuditLog.create({
        data: {
          actor: 'system',
          action: 'support_ticket_reopened',
          payload: {
            ticketId,
            reason: 'Customer reply after auto-close',
            reopenedAt: new Date().toISOString(),
          },
        },
      });

      this.logger.log(`[support-ticket-autoclose] reopened ticket ${ticketId} due to customer reply`);
    }
  }
}
