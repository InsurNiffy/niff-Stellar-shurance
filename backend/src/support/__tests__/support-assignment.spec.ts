import { SupportService } from '../support.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { SupportTicket } from '@prisma/client';

describe('SupportService — Ticket Assignment (#873)', () => {
  let service: SupportService;
  let prismaMock: Partial<PrismaService>;

  const mockTicket: SupportTicket = {
    id: 'ticket-123',
    email: 'user@example.com',
    subject: 'Test Subject',
    message: 'Test Message',
    ipHash: 'hash123',
    status: 'OPEN' as const,
    assignedTo: null,
    firstRespondedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    prismaMock = {
      supportTicket: {
        findUnique: jest.fn().mockResolvedValue(mockTicket),
        update: jest.fn().mockResolvedValue({ ...mockTicket, assignedTo: 'admin@example.com' }),
        findMany: jest.fn().mockResolvedValue([mockTicket]),
        count: jest.fn().mockResolvedValue(1),
      },
      adminAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const configMock = { get: jest.fn(() => 'test-salt') };

    service = new SupportService(
      prismaMock as any,
      { verify: jest.fn().mockResolvedValue(true) } as any,
      configMock as any,
    );
  });

  describe('assignTicket', () => {
    it('assigns ticket to a staff member', async () => {
      const result = await service.assignTicket('ticket-123', 'admin@example.com', 'superadmin@example.com');

      expect(prismaMock.supportTicket?.update).toHaveBeenCalledWith({
        where: { id: 'ticket-123' },
        data: { assignedTo: 'admin@example.com', updatedAt: expect.any(Date) },
      });
      expect(result.assignedTo).toBe('admin@example.com');
    });

    it('unassigns ticket when assignee is null', async () => {
      (prismaMock.supportTicket?.update as jest.Mock).mockResolvedValueOnce({ ...mockTicket, assignedTo: null });

      await service.assignTicket('ticket-123', null, 'superadmin@example.com');

      expect(prismaMock.supportTicket?.update).toHaveBeenCalledWith({
        where: { id: 'ticket-123' },
        data: { assignedTo: null, updatedAt: expect.any(Date) },
      });
    });

    it('creates audit log on assignment', async () => {
      await service.assignTicket('ticket-123', 'admin@example.com', 'superadmin@example.com', '192.168.1.1');

      expect(prismaMock.adminAuditLog?.create).toHaveBeenCalledWith({
        data: {
          actor: 'superadmin@example.com',
          action: 'support_ticket_assigned',
          payload: {
            ticketId: 'ticket-123',
            from: null,
            to: 'admin@example.com',
            timestamp: expect.any(String),
          },
          ipAddress: '192.168.1.1',
        },
      });
    });

    it('throws when ticket not found', async () => {
      (prismaMock.supportTicket?.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.assignTicket('nonexistent', 'admin@example.com', 'superadmin@example.com'))
        .rejects.toThrow(BadRequestException);
    });

    it('logs assignment change', async () => {
      const spy = jest.spyOn(service['logger'], 'log');

      await service.assignTicket('ticket-123', 'admin@example.com', 'superadmin@example.com');

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('ticket-123'),
      );
    });
  });

  describe('listTickets', () => {
    it('returns all tickets when no filter applied', async () => {
      const result = await service.listTickets();

      expect(prismaMock.supportTicket?.findMany).toHaveBeenCalledWith({
        where: {},
        take: 50,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      });
      expect(result.tickets).toHaveLength(1);
    });

    it('filters tickets by assignee', async () => {
      await service.listTickets(50, 0, 'admin@example.com');

      expect(prismaMock.supportTicket?.findMany).toHaveBeenCalledWith({
        where: { assignedTo: 'admin@example.com' },
        take: 50,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('shows unassigned tickets when assignedTo is null', async () => {
      await service.listTickets(50, 0, null);

      expect(prismaMock.supportTicket?.findMany).toHaveBeenCalledWith({
        where: { assignedTo: undefined },
        take: 50,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('respects pagination limits', async () => {
      await service.listTickets(25, 50);

      expect(prismaMock.supportTicket?.findMany).toHaveBeenCalledWith({
        where: {},
        take: 25,
        skip: 50,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('mapToResponse', () => {
    it('includes assignedTo in response', () => {
      const ticketWithAssignee = { ...mockTicket, assignedTo: 'admin@example.com' };
      const result = (service as any).mapToResponse(ticketWithAssignee);

      expect(result.assignedTo).toBe('admin@example.com');
    });

    it('returns null for unassigned tickets', () => {
      const result = (service as any).mapToResponse(mockTicket);

      expect(result.assignedTo).toBeNull();
    });
  });
});
