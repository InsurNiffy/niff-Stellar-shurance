import { Test, TestingModule } from '@nestjs/testing';
import { TenantConfigAuditService } from './tenant-config-audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TenantConfigAuditService', () => {
  let service: TenantConfigAuditService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantConfigAuditService,
        {
          provide: PrismaService,
          useValue: {
            tenantConfigAuditLog: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<TenantConfigAuditService>(TenantConfigAuditService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('recordConfigChange', () => {
    it('creates an audit entry for a config change', async () => {
      const mockEntry = {
        id: 'uuid-1',
        tenantId: 'acme',
        actor: 'admin@example.com',
        key: 'solvency_threshold',
        oldValue: '"5000000000"',
        newValue: '"10000000000"',
        createdAt: new Date(),
      };

      jest
        .spyOn(prisma.tenantConfigAuditLog, 'create')
        .mockResolvedValue(mockEntry);

      const result = await service.recordConfigChange({
        tenantId: 'acme',
        actor: 'admin@example.com',
        key: 'solvency_threshold',
        oldValue: '5000000000',
        newValue: '10000000000',
      });

      expect(result.id).toBe('uuid-1');
      expect(result.tenantId).toBe('acme');
      expect(result.key).toBe('solvency_threshold');
      expect(prisma.tenantConfigAuditLog.create).toHaveBeenCalled();
    });

    it('serializes values as JSON strings', async () => {
      const mockEntry = {
        id: 'uuid-2',
        tenantId: 'tenant-2',
        actor: 'user@test.com',
        key: 'config_key',
        oldValue: '5',
        newValue: '10',
        createdAt: new Date(),
      };

      jest
        .spyOn(prisma.tenantConfigAuditLog, 'create')
        .mockResolvedValue(mockEntry);

      await service.recordConfigChange({
        tenantId: 'tenant-2',
        actor: 'user@test.com',
        key: 'config_key',
        oldValue: 5,
        newValue: 10,
      });

      const call = (prisma.tenantConfigAuditLog.create as jest.Mock).mock
        .calls[0][0];
      expect(call.data.oldValue).toBe('5');
      expect(call.data.newValue).toBe('10');
    });

    it('stores null for oldValue when value is undefined', async () => {
      const mockEntry = {
        id: 'uuid-3',
        tenantId: 'tenant-3',
        actor: 'user@test.com',
        key: 'new_key',
        oldValue: null,
        newValue: '"value"',
        createdAt: new Date(),
      };

      jest
        .spyOn(prisma.tenantConfigAuditLog, 'create')
        .mockResolvedValue(mockEntry);

      await service.recordConfigChange({
        tenantId: 'tenant-3',
        actor: 'user@test.com',
        key: 'new_key',
        oldValue: undefined,
        newValue: 'value',
      });

      const call = (prisma.tenantConfigAuditLog.create as jest.Mock).mock
        .calls[0][0];
      expect(call.data.oldValue).toBeNull();
    });
  });

  describe('getAuditHistory', () => {
    it('returns paginated audit entries in chronological order', async () => {
      const mockEntries = [
        {
          id: 'uuid-1',
          tenantId: 'acme',
          actor: 'admin1@example.com',
          key: 'threshold',
          oldValue: '"1000"',
          newValue: '"2000"',
          createdAt: new Date('2026-07-26T10:00:00Z'),
        },
        {
          id: 'uuid-2',
          tenantId: 'acme',
          actor: 'admin2@example.com',
          key: 'threshold',
          oldValue: '"2000"',
          newValue: '"3000"',
          createdAt: new Date('2026-07-26T11:00:00Z'),
        },
      ];

      jest
        .spyOn(prisma.tenantConfigAuditLog, 'findMany')
        .mockResolvedValue(mockEntries);
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'count')
        .mockResolvedValue(2);

      const result = await service.getAuditHistory({
        tenantId: 'acme',
        limit: 50,
        offset: 0,
      });

      expect(result.entries).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.entries[0].createdAt).toStrictEqual(mockEntries[0].createdAt);
    });

    it('filters by key when provided', async () => {
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'findMany')
        .mockResolvedValue([]);
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'count')
        .mockResolvedValue(0);

      await service.getAuditHistory({
        tenantId: 'acme',
        key: 'specific_key',
      });

      const call = (prisma.tenantConfigAuditLog.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.where.key).toBe('specific_key');
    });

    it('filters by actor when provided', async () => {
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'findMany')
        .mockResolvedValue([]);
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'count')
        .mockResolvedValue(0);

      await service.getAuditHistory({
        tenantId: 'acme',
        actor: 'specific_admin@example.com',
      });

      const call = (prisma.tenantConfigAuditLog.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.where.actor).toBe('specific_admin@example.com');
    });

    it('applies pagination with limit and offset', async () => {
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'findMany')
        .mockResolvedValue([]);
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'count')
        .mockResolvedValue(100);

      await service.getAuditHistory({
        tenantId: 'acme',
        limit: 25,
        offset: 50,
      });

      const call = (prisma.tenantConfigAuditLog.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.take).toBe(25);
      expect(call.skip).toBe(50);
    });

    it('orders results by createdAt ascending (chronological)', async () => {
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'findMany')
        .mockResolvedValue([]);
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'count')
        .mockResolvedValue(0);

      await service.getAuditHistory({ tenantId: 'acme' });

      const call = (prisma.tenantConfigAuditLog.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.orderBy.createdAt).toBe('asc');
    });
  });

  describe('getKeyHistory', () => {
    it('returns all changes for a specific key in a tenant', async () => {
      const mockEntries = [
        {
          id: 'uuid-1',
          tenantId: 'acme',
          actor: 'admin1@example.com',
          key: 'api_rate_limit',
          oldValue: '"100"',
          newValue: '"200"',
          createdAt: new Date('2026-07-26T10:00:00Z'),
        },
        {
          id: 'uuid-2',
          tenantId: 'acme',
          actor: 'admin2@example.com',
          key: 'api_rate_limit',
          oldValue: '"200"',
          newValue: '"300"',
          createdAt: new Date('2026-07-26T11:00:00Z'),
        },
      ];

      jest
        .spyOn(prisma.tenantConfigAuditLog, 'findMany')
        .mockResolvedValue(mockEntries);

      const result = await service.getKeyHistory('acme', 'api_rate_limit');

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('api_rate_limit');
      expect(result[1].key).toBe('api_rate_limit');
    });

    it('orders changes by createdAt ascending', async () => {
      jest
        .spyOn(prisma.tenantConfigAuditLog, 'findMany')
        .mockResolvedValue([]);

      await service.getKeyHistory('acme', 'some_key');

      const call = (prisma.tenantConfigAuditLog.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.orderBy.createdAt).toBe('asc');
      expect(call.where.tenantId).toBe('acme');
      expect(call.where.key).toBe('some_key');
    });
  });
});
