import { SupportService } from '../support.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptchaService } from '../captcha.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockTicket = {
  id: 'uuid-1',
  email: 'user@example.com',
  subject: 'Test subject',
  message: 'Test message body here',
  status: 'OPEN',
  ipHash: 'hash',
  firstRespondedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockFaqItem = {
  id: 'faq-1',
  question: 'What is NiffyInsur?',
  answer: 'A decentralized insurance protocol.',
  category: 'General',
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrisma(ticket = mockTicket) {
  return {
    supportTicket: {
      create: jest.fn().mockResolvedValue(ticket),
      findUnique: jest.fn().mockResolvedValue(ticket),
      update: jest.fn().mockResolvedValue({ ...ticket, status: 'RESOLVED' }),
      findMany: jest.fn().mockResolvedValue([ticket]),
      count: jest.fn().mockResolvedValue(1),
    },
    supportTicketReply: {
      create: jest.fn().mockResolvedValue({ id: 'reply-1', ticketId: 'uuid-1', message: 'Response', author: 'customer', createdAt: new Date() }),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    faqStat: { upsert: jest.fn().mockResolvedValue({}) },
    faqItem: {
      findMany: jest.fn().mockResolvedValue([mockFaqItem]),
      findUnique: jest.fn().mockResolvedValue(mockFaqItem),
      create: jest.fn().mockResolvedValue(mockFaqItem),
      update: jest.fn().mockResolvedValue({ ...mockFaqItem, question: 'Updated?' }),
      delete: jest.fn().mockResolvedValue(mockFaqItem),
      aggregate: jest.fn().mockResolvedValue({ _max: { displayOrder: 0 } }),
    },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
}

function makeCaptcha(valid = true) {
  return { verify: jest.fn().mockResolvedValue(valid) } as unknown as CaptchaService;
}

function makeConfig() {
  return {
    get: jest.fn().mockImplementation((key: string, def?: string) => def ?? ''),
  } as unknown as ConfigService;
}

describe('SupportService', () => {
  it('creates ticket when CAPTCHA passes', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(true), makeConfig());
    const result = await svc.submitTicket(
      { email: 'user@example.com', subject: 'Test', message: 'Hello world', captchaToken: 'tok' },
      '1.2.3.4',
    );
    expect(result.id).toBe('uuid-1');
    expect(prisma.supportTicket.create).toHaveBeenCalled();
  });

  it('rejects ticket when CAPTCHA fails', async () => {
    const svc = new SupportService(makePrisma(), makeCaptcha(false), makeConfig());
    await expect(
      svc.submitTicket(
        { email: 'user@example.com', subject: 'Test', message: 'Hello', captchaToken: 'bad' },
        '1.2.3.4',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores hashed IP, not raw IP', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(true), makeConfig());
    await svc.submitTicket(
      { email: 'user@example.com', subject: 'Test', message: 'Hello world', captchaToken: 'tok' },
      '1.2.3.4',
    );
    const createCall = (prisma.supportTicket.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.ipHash).toBeDefined();
    expect(createCall.data.ipHash).not.toBe('1.2.3.4');
  });

  it('updateTicketStatus writes audit log', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await svc.updateTicketStatus('uuid-1', { status: 'RESOLVED' }, 'GADMIN');
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'support_ticket_status_updated' }),
      }),
    );
  });

  it('updateTicketStatus sets firstRespondedAt on first response', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await svc.updateTicketStatus('uuid-1', { status: 'IN_PROGRESS' }, 'GADMIN');
    const updateCall = (prisma.supportTicket.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.firstRespondedAt).toBeDefined();
  });

  it('updateTicketStatus does not overwrite existing firstRespondedAt', async () => {
    const prisma = makePrisma();
    const existingDate = new Date('2026-01-01');
    (prisma.supportTicket.findUnique as jest.Mock).mockResolvedValue({
      ...mockTicket,
      firstRespondedAt: existingDate,
    });
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await svc.updateTicketStatus('uuid-1', { status: 'RESOLVED' }, 'GADMIN');
    const updateCall = (prisma.supportTicket.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.firstRespondedAt).toBeUndefined();
  });

  it('updateTicketStatus throws when ticket not found', async () => {
    const prisma = makePrisma();
    (prisma.supportTicket.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await expect(svc.updateTicketStatus('bad-id', { status: 'RESOLVED' }, 'GADMIN')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('getFirstResponseStats returns avgFirstResponseMs and slaBreachedCount', async () => {
    const respondedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const createdAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
    const prisma = makePrisma();
    (prisma.supportTicket.findMany as jest.Mock).mockResolvedValue([
      { createdAt, firstRespondedAt: respondedAt },
    ]);
    (prisma.supportTicket.count as jest.Mock).mockResolvedValue(2);
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    const stats = await svc.getFirstResponseStats(24);
    expect(stats.totalResponded).toBe(1);
    expect(stats.avgFirstResponseMs).toBeGreaterThan(0);
    expect(stats.slaBreachedCount).toBe(2);
  });
});

describe('SupportService — FAQ CRUD', () => {
  it('listFaqItems returns ordered items', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    const items = await svc.listFaqItems();
    expect(items).toHaveLength(1);
    expect(prisma.faqItem.findMany).toHaveBeenCalledWith({ orderBy: { displayOrder: 'asc' } });
  });

  it('createFaqItem assigns next displayOrder', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await svc.createFaqItem({ question: 'Q?', answer: 'A answer here.' });
    expect(prisma.faqItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayOrder: 1 }) }),
    );
  });

  it('updateFaqItem throws NotFoundException when item missing', async () => {
    const prisma = makePrisma();
    (prisma.faqItem.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await expect(svc.updateFaqItem('missing', { question: 'X?' })).rejects.toThrow(NotFoundException);
  });

  it('deleteFaqItem throws NotFoundException when item missing', async () => {
    const prisma = makePrisma();
    (prisma.faqItem.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await expect(svc.deleteFaqItem('missing')).rejects.toThrow(NotFoundException);
  });

  it('reorderFaqItems runs one update per entry in a transaction', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await svc.reorderFaqItems({ items: [{ id: 'faq-1', displayOrder: 2 }] });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('SupportService — Customer replies', () => {
  it('addCustomerReply creates reply record', async () => {
    const prisma = makePrisma();
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await svc.addCustomerReply('uuid-1', 'Customer response');
    expect(prisma.supportTicketReply.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 'uuid-1', message: 'Customer response', author: 'customer' }),
      }),
    );
  });

  it('addCustomerReply throws when ticket not found', async () => {
    const prisma = makePrisma();
    (prisma.supportTicket.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig());
    await expect(svc.addCustomerReply('bad-id', 'Message')).rejects.toThrow(BadRequestException);
  });

  it('addCustomerReply triggers autoclose reopen logic', async () => {
    const prisma = makePrisma();
    const mockAutoclose = { reopenIfReply: jest.fn() };
    const svc = new SupportService(prisma, makeCaptcha(), makeConfig(), mockAutoclose as any);
    await svc.addCustomerReply('uuid-1', 'Customer response');
    expect(mockAutoclose.reopenIfReply).toHaveBeenCalledWith('uuid-1');
  });
});
