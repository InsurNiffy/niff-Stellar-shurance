import {
  WebhookSubscriptionsService,
  WEBHOOK_DNS_LOOKUP,
} from './webhook-subscriptions.service';

function makeService(lookup = jest.fn().mockResolvedValue(['93.184.216.34'])) {
  const prisma = {
    webhookSubscription: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new WebhookSubscriptionsService(prisma as never, lookup);
  return { service, prisma, lookup };
}

describe('WebhookSubscriptionsService — CRUD (#1484)', () => {
  it('creates a subscription with an auto-generated secret', async () => {
    const { service, prisma } = makeService();
    prisma.webhookSubscription.create.mockImplementation((args: { data: unknown }) =>
      Promise.resolve({ id: 'sub_1', ...args.data }),
    );

    const dto = { url: 'https://partners.example.com/hook', events: ['claim.finalized'] as const };
    const result = await service.create(dto as never);

    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.webhookSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          url: 'https://partners.example.com/hook',
          events: ['claim.finalized'],
        }),
      }),
    );
    expect(service).toBeInstanceOf(WebhookSubscriptionsService);
    expect(WEBHOOK_DNS_LOOKUP).toBe('WEBHOOK_DNS_LOOKUP');
  });

  it('keeps a caller-supplied secret', async () => {
    const { service, prisma } = makeService();
    prisma.webhookSubscription.create.mockImplementation((args: { data: unknown }) =>
      Promise.resolve(args.data),
    );

    const created = await service.create({
      url: 'https://partners.example.com/hook',
      events: ['claim.paid'],
      secret: 'provided-secret-0123456789',
    } as never);

    expect(created.secret).toBe('provided-secret-0123456789');
  });

  describe('SSRF validation on write', () => {
    it('rejects http:// subscriptions before persisting', async () => {
      const { service, prisma } = makeService();
      const rejected = service.create({ url: 'http://evil.example.com/hook', events: ['claim.paid'] } as never);
      await expect(rejected).rejects.toThrow('is not https');
      await expect(rejected).rejects.toMatchObject({ status: 400 });
      expect(prisma.webhookSubscription.create).not.toHaveBeenCalled();
    });

    it('rejects URLs that resolve to private addresses', async () => {
      const lookup = jest.fn().mockResolvedValue(['10.0.0.5']);
      const { service, prisma } = makeService(lookup);
      const rejected = service.create({ url: 'https://internal.example.com/hook', events: ['claim.paid'] } as never);
      await expect(rejected).rejects.toThrow('Blocked unsafe webhook URL');
      await expect(rejected).rejects.toMatchObject({ status: 400 });
      expect(prisma.webhookSubscription.create).not.toHaveBeenCalled();
    });

    it('rejects loopback / metadata targets', async () => {
      const { service, prisma } = makeService();
      for (const url of [
        'https://127.0.0.1/hook',
        'https://169.254.169.254/hook',
        'https://[::1]/hook',
        'https://localhost/hook',
      ]) {
        await expect(
          service.create({ url, events: ['claim.paid'] } as never),
        ).rejects.toThrow('Blocked unsafe webhook URL');
      }
      expect(prisma.webhookSubscription.create).not.toHaveBeenCalled();
    });

    it('re-validates the URL on update', async () => {
      const { service, prisma } = makeService();
      prisma.webhookSubscription.findUnique.mockResolvedValue({ id: 'sub_1' });
      await expect(
        service.update('sub_1', { url: 'http://insecure.example.com' }),
      ).rejects.toThrow('is not https');
      expect(prisma.webhookSubscription.update).not.toHaveBeenCalled();
    });
  });

  it('updates provided fields only', async () => {
    const { service, prisma } = makeService();
    prisma.webhookSubscription.findUnique.mockResolvedValue({ id: 'sub_1' });
    prisma.webhookSubscription.update.mockResolvedValue({ id: 'sub_1', active: false });

    await service.update('sub_1', { active: false });

    expect(prisma.webhookSubscription.update).toHaveBeenCalledWith({
      where: { id: 'sub_1' },
      data: { active: false },
    });
  });

  it('404s on missing subscriptions', async () => {
    const { service, prisma } = makeService();
    prisma.webhookSubscription.findUnique.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toThrow('not found');
    await expect(service.remove('missing')).rejects.toThrow('not found');
  });

  it('deletes existing subscriptions', async () => {
    const { service, prisma } = makeService();
    prisma.webhookSubscription.findUnique.mockResolvedValue({ id: 'sub_1' });
    prisma.webhookSubscription.delete.mockResolvedValue({ id: 'sub_1' });

    await expect(service.remove('sub_1')).resolves.toEqual({ deleted: true, id: 'sub_1' });
  });

  it('lists active subscribers for an event type', async () => {
    const { service, prisma } = makeService();
    prisma.webhookSubscription.findMany.mockResolvedValue([{ id: 'sub_1' }]);

    await service.findSubscribers('claim.paid');

    expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith({
      where: { active: true, events: { has: 'claim.paid' } },
    });
  });
});
