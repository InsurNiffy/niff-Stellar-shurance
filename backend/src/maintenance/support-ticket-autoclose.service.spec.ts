import { SupportTicketAutocloseService } from './support-ticket-autoclose.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

const mockTicket = {
  id: 'ticket-1',
  email: 'user@example.com',
  subject: 'Test',
  message: 'Help',
  status: 'OPEN',
  ipHash: 'hash',
  assignedTo: null,
  firstRespondedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
  createdAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
};

const closedTicket = {
  ...mockTicket,
  status: 'CLOSED',
};

function makePrisma() {
  return {
    supportTicket: {
      findMany: jest.fn().mockResolvedValue([mockTicket]),
      findUnique: jest.fn().mockResolvedValue(closedTicket),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({ ...closedTicket, status: 'IN_PROGRESS' }),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

function makeConfig(daysInactive?: number) {
  return {
    get: jest.fn().mockImplementation((key: string, def?: any) => {
      if (key === 'SUPPORT_TICKET_AUTOCLOSE_DAYS_INACTIVE') return daysInactive || null;
      return def ?? null;
    }),
  } as unknown as ConfigService;
}

describe('SupportTicketAutocloseService', () => {
  it('closes inactive tickets', async () => {
    const prisma = makePrisma();
    const svc = new SupportTicketAutocloseService(prisma, makeConfig(7));
    const count = await svc.autoCloseInactiveTickets();
    expect(count).toBe(1);
    expect(prisma.supportTicket.updateMany).toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).toHaveBeenCalled();
  });

  it('respects configured inactivity window', async () => {
    const prisma = makePrisma();
    const config = makeConfig(5);
    const svc = new SupportTicketAutocloseService(prisma, config);
    await svc.autoCloseInactiveTickets();
    expect(config.get).toHaveBeenCalledWith('SUPPORT_TICKET_AUTOCLOSE_DAYS_INACTIVE');
  });

  it('reopens ticket on customer reply', async () => {
    const prisma = makePrisma();
    const svc = new SupportTicketAutocloseService(prisma, makeConfig());
    await svc.reopenIfReply('ticket-1');
    expect(prisma.supportTicket.update).toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).toHaveBeenCalled();
  });

  it('does not reopen non-closed tickets', async () => {
    const prisma = makePrisma();
    prisma.supportTicket.findUnique = jest.fn().mockResolvedValue({ ...mockTicket, status: 'OPEN' });
    const svc = new SupportTicketAutocloseService(prisma, makeConfig());
    await svc.reopenIfReply('ticket-1');
    expect(prisma.supportTicket.update).not.toHaveBeenCalled();
  });

  it('returns zero when no tickets to close', async () => {
    const prisma = makePrisma();
    prisma.supportTicket.findMany = jest.fn().mockResolvedValue([]);
    const svc = new SupportTicketAutocloseService(prisma, makeConfig());
    const count = await svc.autoCloseInactiveTickets();
    expect(count).toBe(0);
  });
});
