import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const mockAdminService = { enqueueReindex: jest.fn(), setFeatureFlag: jest.fn(), getFeatureFlags: jest.fn() };
const mockAuditService = { write: jest.fn(), findAll: jest.fn() };

const adminReq = (role = 'admin') => ({ user: { walletAddress: 'GADMIN', role }, ip: '127.0.0.1' });

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(AdminRoleGuard).useValue({ canActivate: (ctx: any) => {
        const role = ctx.switchToHttp().getRequest().user?.role;
        if (role !== 'admin') throw new ForbiddenException('Admin role required');
        return true;
      }})
      .compile();

    controller = module.get(AdminController);
  });

  describe('POST /admin/reindex', () => {
    it('enqueues job and writes audit row', async () => {
      mockAdminService.enqueueReindex.mockResolvedValue('job-123');
      const result = await controller.reindex({ fromLedger: 500 }, adminReq() as any);
      expect(result).toEqual({ jobId: 'job-123', fromLedger: 500, status: 'queued' });
      expect(mockAdminService.enqueueReindex).toHaveBeenCalledWith(500);
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'GADMIN', action: 'reindex', payload: expect.objectContaining({ fromLedger: 500 }) }),
      );
    });
  });

  describe('GET /admin/audits', () => {
    it('returns paginated audit logs', async () => {
      mockAuditService.findAll.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
      const result = await controller.getAudits({ page: 1, limit: 20 });
      expect(mockAuditService.findAll).toHaveBeenCalledWith(1, 20, undefined);
      expect(result.total).toBe(0);
    });
  });

  describe('PATCH /admin/feature-flags/:key', () => {
    it('updates flag and writes audit row', async () => {
      const flag = { key: 'claims_enabled', enabled: false, updatedBy: 'GADMIN' };
      mockAdminService.setFeatureFlag.mockResolvedValue(flag);
      const result = await controller.setFeatureFlag('claims_enabled', { enabled: false }, adminReq() as any);
      expect(result).toEqual(flag);
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'feature_flag_update', payload: expect.objectContaining({ key: 'claims_enabled', enabled: false }) }),
      );
    });
  });

  describe('Role guard — non-admin access denied', () => {
    it('throws ForbiddenException for support_readonly on reindex', async () => {
      const guard = new AdminRoleGuard();
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ user: { role: 'support_readonly' } }) }),
      } as any;
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when no user present', async () => {
      const guard = new AdminRoleGuard();
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({}) }),
      } as any;
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('allows admin role through', () => {
      const guard = new AdminRoleGuard();
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ user: { role: 'admin' } }) }),
      } as any;
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
