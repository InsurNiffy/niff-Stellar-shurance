import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminPoliciesService } from './admin-policies.service';
import { AuditService } from './audit.service';
import { PrivacyService } from '../maintenance/privacy.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrivacyService } from '../maintenance/privacy.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';

const mockAdminService = { enqueueReindex: jest.fn(), setFeatureFlag: jest.fn(), getFeatureFlags: jest.fn() };
const mockAdminPoliciesService = { listPolicies: jest.fn(), softDeletePolicy: jest.fn() };
const mockAuditService = { write: jest.fn(), findAll: jest.fn() };
const mockConfigService = {
  get: jest.fn((key: string, def?: string) => (key === 'STELLAR_NETWORK' ? 'testnet' : def)),
};

const adminReq = (role = 'admin') => ({ user: { walletAddress: 'GADMIN', role }, ip: '127.0.0.1' });
const toExecutionContext = (role?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => (role ? { user: { role } } : {}) }),
  }) as unknown as ExecutionContext;

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: AdminPoliciesService, useValue: mockAdminPoliciesService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrivacyService, useValue: {} },
        { provide: RateLimitService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(AdminRoleGuard).useValue({ canActivate: (ctx: ExecutionContext) => {
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
      const result = await controller.reindex({ fromLedger: 500 }, adminReq() as unknown as Request);
      expect(result).toEqual({
        jobId: 'job-123',
        fromLedger: 500,
        network: 'testnet',
        status: 'queued',
      });
      expect(mockAdminService.enqueueReindex).toHaveBeenCalledWith(500, 'testnet');
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'GADMIN',
          action: 'reindex',
          payload: expect.objectContaining({ fromLedger: 500, network: 'testnet' }),
        }),
      );
    });

    it('passes explicit network to enqueue', async () => {
      mockAdminService.enqueueReindex.mockResolvedValue('job-456');
      await controller.reindex(
        { fromLedger: 100, network: 'public' },
        adminReq() as unknown as Request,
      );
      expect(mockAdminService.enqueueReindex).toHaveBeenCalledWith(100, 'public');
    });
  });

  describe('GET /admin/policies', () => {
    it('passes include_deleted=false by default', async () => {
      mockAdminPoliciesService.listPolicies.mockResolvedValue({ policies: [] });
      await controller.getAdminPolicies(undefined);
      expect(mockAdminPoliciesService.listPolicies).toHaveBeenCalledWith(false);
    });

    it('passes include_deleted=true when query set', async () => {
      mockAdminPoliciesService.listPolicies.mockResolvedValue({ policies: [] });
      await controller.getAdminPolicies('true');
      expect(mockAdminPoliciesService.listPolicies).toHaveBeenCalledWith(true);
    });
  });

  describe('DELETE /admin/policies/:holder/:policyId', () => {
    it('soft-deletes and audits', async () => {
      mockAdminPoliciesService.softDeletePolicy.mockResolvedValue({
        id: 'GX:1',
        deletedAt: new Date().toISOString(),
        alreadyDeleted: false,
      });
      const res = await controller.softDeletePolicy('GX', '1', adminReq() as unknown as Request);
      expect(res.id).toBe('GX:1');
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'policy_soft_delete' }),
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
      const result = await controller.setFeatureFlag('claims_enabled', { enabled: false }, adminReq() as unknown as Request);
      expect(result).toEqual(flag);
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'feature_flag_update', payload: expect.objectContaining({ key: 'claims_enabled', enabled: false }) }),
      );
    });
  });

  describe('Role guard — non-admin access denied', () => {
    it('throws ForbiddenException for support_readonly on reindex', async () => {
      const guard = new AdminRoleGuard();
      const ctx = toExecutionContext('support_readonly');
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when no user present', async () => {
      const guard = new AdminRoleGuard();
      const ctx = toExecutionContext();
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('allows admin role through', () => {
      const guard = new AdminRoleGuard();
      const ctx = toExecutionContext('admin');
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
