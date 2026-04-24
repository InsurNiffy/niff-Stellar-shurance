import { Test, TestingModule } from '@nestjs/testing';
import { PrivacyService } from './privacy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../admin/audit.service';

describe('PrivacyService', () => {
  let service: PrivacyService;
  let prisma: jest.Mocked<PrismaService>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivacyService,
        {
          provide: PrismaService,
          useValue: {
            privacyRequest: {
              create: jest.fn(),
              update: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
            claim: {
              updateMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
        {
          provide: AuditService,
          useValue: {
            write: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PrivacyService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
  });

  describe('handleRequest', () => {
    it('should anonymize and audit', async () => {
      prisma.privacyRequest.create.mockResolvedValue({ id: 'req1' } as any);
      prisma.claim.updateMany.mockResolvedValue({ count: 1 });
      prisma.privacyRequest.update.mockResolvedValue({} as any);

      const result = await service.handleRequest({
        subjectWalletAddress: 'GABC',
        requestType: 'ANONYMIZE',
        requestedBy: 'admin',
        notes: 'test',
      });

      expect(result.requestId).toBe('req1');
      expect(result.rowsAffected).toBe(1);
      expect(audit.write).toHaveBeenCalled();
    });

    it('should delete and audit', async () => {
      prisma.privacyRequest.create.mockResolvedValue({ id: 'req2' } as any);
      prisma.claim.deleteMany.mockResolvedValue({ count: 2 });
      prisma.privacyRequest.update.mockResolvedValue({} as any);

      const result = await service.handleRequest({
        subjectWalletAddress: 'GXYZ',
        requestType: 'DELETE',
        requestedBy: 'admin',
      });

      expect(result.requestId).toBe('req2');
      expect(result.rowsAffected).toBe(2);
    });
  });

  describe('anonymize', () => {
    it('should update claims', async () => {
      prisma.claim.updateMany.mockResolvedValue({ count: 3 });

      const result = await (service as any).anonymize('GABC');

      expect(result).toBe(3);
      expect(prisma.claim.updateMany).toHaveBeenCalledWith({
        where: { creatorAddress: 'GABC', deletedAt: null },
        data: { description: '[redacted]', imageUrls: [] },
      });
    });
  });

  describe('delete', () => {
    it('should delete claims', async () => {
      prisma.claim.deleteMany.mockResolvedValue({ count: 1 });

      const result = await (service as any).delete('GXYZ');

      expect(result).toBe(1);
      expect(prisma.claim.deleteMany).toHaveBeenCalledWith({
        where: {
          creatorAddress: 'GXYZ',
          isFinalized: false,
          deletedAt: null,
        },
      });
    });
  });
});