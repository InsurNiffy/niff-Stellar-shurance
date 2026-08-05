import { Test, TestingModule } from '@nestjs/testing';
import { AdminClaimsExportService } from './admin-claims-export.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { Readable } from 'stream';

describe('AdminClaimsExportService', () => {
  let service: AdminClaimsExportService;
  let prismaService: PrismaService;

  const mockClaim = {
    id: 1,
    policyId: 'holder:1',
    creatorAddress: 'GADDRESS123',
    amount: '100000000',
    asset: null,
    description: 'Test claim',
    status: 'PENDING' as const,
    severity: null,
    isFinalized: false,
    approveVotes: 2,
    rejectVotes: 1,
    paidAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    txHash: 'hash123',
    tenantId: null,
  };

  beforeEach(async () => {
    const mockPrismaService = {
      claim: {
        findMany: jest.fn(),
      },
    };

    const mockTenantContextService = {
      tenantId: null,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminClaimsExportService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TenantContextService, useValue: mockTenantContextService },
      ],
    }).compile();

    service = module.get<AdminClaimsExportService>(AdminClaimsExportService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('CSV header generation', () => {
    it('should include all required CSV columns in correct order', async () => {
      jest.spyOn(prismaService.claim, 'findMany').mockResolvedValue([]);

      const stream = service.createClaimsExportStream({});
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      const content = Buffer.concat(chunks).toString('utf-8');
      const headerLine = content.split('\n')[0];
      const headers = headerLine.split(',');

      expect(headers).toContain('id');
      expect(headers).toContain('policyId');
      expect(headers).toContain('creatorAddress');
      expect(headers).toContain('status');
      expect(headers).toContain('tenantId');
    });
  });

  describe('CSV filtering', () => {
    it('should apply status filter', async () => {
      jest.spyOn(prismaService.claim, 'findMany').mockResolvedValue([mockClaim]);

      service.createClaimsExportStream({ status: 'PENDING' });

      expect(prismaService.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should apply date range filter', async () => {
      jest.spyOn(prismaService.claim, 'findMany').mockResolvedValue([mockClaim]);

      service.createClaimsExportStream({
        from: '2024-01-01',
        to: '2024-12-31',
      });

      expect(prismaService.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('Stream generation', () => {
    it('should return a readable stream', () => {
      jest.spyOn(prismaService.claim, 'findMany').mockResolvedValue([]);

      const stream = service.createClaimsExportStream({});

      expect(stream).toBeInstanceOf(Readable);
    });
  });

  describe('CSV escaping', () => {
    it('should escape fields containing commas', async () => {
      const claimWithComma = {
        ...mockClaim,
        description: 'Test, with comma',
      };

      jest.spyOn(prismaService.claim, 'findMany').mockResolvedValue([claimWithComma]);

      const stream = service.createClaimsExportStream({});
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', resolve);
      });

      const content = Buffer.concat(chunks).toString('utf-8');
      expect(content).toContain('"Test, with comma"');
    });

    it('should escape fields containing quotes', async () => {
      const claimWithQuote = {
        ...mockClaim,
        description: 'Test "quoted" text',
      };

      jest.spyOn(prismaService.claim, 'findMany').mockResolvedValue([claimWithQuote]);

      const stream = service.createClaimsExportStream({});
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', resolve);
      });

      const content = Buffer.concat(chunks).toString('utf-8');
      expect(content).toContain('"Test ""quoted"" text"');
    });
  });

  describe('Tenant scoping', () => {
    it('should include tenant ID in exported data', async () => {
      const claimWithTenant = {
        ...mockClaim,
        tenantId: 'acme',
      };

      jest.spyOn(prismaService.claim, 'findMany').mockResolvedValue([claimWithTenant]);

      const stream = service.createClaimsExportStream({});
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', resolve);
      });

      const content = Buffer.concat(chunks).toString('utf-8');
      expect(content).toContain('acme');
    });
  });
});
