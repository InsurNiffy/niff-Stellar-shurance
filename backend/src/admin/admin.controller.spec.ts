import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminPoliciesService } from './admin-policies.service';
import { AuditService } from './audit.service';
import { PrivacyService } from '../maintenance/privacy.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { QueueMonitorService } from '../queues/queue-monitor.service';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const mockAdminService = {
  enqueueReindex: jest.fn(),
  setFeatureFlag: jest.fn(),
  getFeatureFlags: jest.fn(),
};
const mockAdminPoliciesService = {
  listPolicies: jest.fn(),
  softDeletePolicy: jest.fn(),
};
const mockAuditService = {
  write: jest.fn(),
  findAll: jest.fn(),
  streamCsv: jest.fn(),
};
const mockConfigService = {
  get: jest.fn((key: string, def?: string) => (key === 'STELLAR_NETWORK' ? 'testnet' : def)),
};
const mockSolvencyMonitoringService = {
  getLatestSnapshot: jest.fn(),
};
const mockQueueMonitorService = {
  replayJob: jest.fn(),
  getQueues: jest.fn().mockReturnValue([]),
};

const adminReq = (role = 'admin') =>
  ({ user: { walletAddress: 'GADMIN', role }, ip: '127.0.0.1' } as unknown as Request);

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
        { provide: PrivacyService, useValue: { handleRequest: jest.fn(), listRequests: jest.fn() } },
        { provide: RateLimitService, useValue: { setLimit: jest.fn(), getCounterState: jest.fn(), enableOverride: jest.fn(), disableOverride: jest.fn() } },
        { provide: QueueMonitorService, useValue: mockQueueMonitorService },
        // SolvencyMonitoringService is injected via MaintenanceModule; provide stub here
        {
          provide: 'SolvencyMonitoringService',
          useValue: mockSolvencyMonitoringService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminRoleGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const role = ctx.switchToHttp().getRequest().user?.role;
          if (role !== 'admin') throw new ForbiddenException('Admin role required');
          return true;
        },
      })
      .compile();

    controller = module.get(AdminController);
    // Inject solvency service manually since it's not a NestJS token in the controller
    (controller as unknown as Record<string, unknown>)['solvencyMonitoringService'] =
      mockSolvencyMonitoringService;
  });

  // ── POST /admin/reindex ──────────────────────────────────────────────────

  describe('POST /admin/reindex', () => {
    it('enqueues job and writes audit row', async () => {
      mockAdminService.enqueueReindex.mockResolvedValue('job-123');
      const result = await controller.reindex({ fromLedger: 500 }, adminReq());
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
      await controller.reindex({ fromLedger: 100, network: 'public' }, adminReq());
      expect(mockAdminService.enqueueReindex).toHaveBeenCalledWith(100, 'public');
    });
  });

  // ── GET /admin/policies ──────────────────────────────────────────────────

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

  // ── DELETE /admin/policies/:holder/:policyId ─────────────────────────────

  describe('DELETE /admin/policies/:holder/:policyId', () => {
    it('soft-deletes and audits', async () => {
      mockAdminPoliciesService.softDeletePolicy.mockResolvedValue({
        id: 'GX:1',
        deletedAt: new Date().toISOString(),
        alreadyDeleted: false,
      });
      const res = await controller.softDeletePolicy('GX', '1', adminReq());
      expect(res.id).toBe('GX:1');
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'policy_soft_delete' }),
      );
    });
  });

  // ── GET /admin/audits ────────────────────────────────────────────────────

  describe('GET /admin/audits', () => {
    it('returns paginated audit logs and writes meta-audit', async () => {
      const mockResult = { items: [], nextCursor: null, hasMore: false };
      mockAuditService.findAll.mockResolvedValue(mockResult);

      const query = { limit: 20 };
      const result = await controller.getAudits(query as never, adminReq());

      expect(mockAuditService.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockResult);
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'GADMIN', action: 'audit_log_read' }),
      );
    });

    it('passes filter params to findAll', async () => {
      mockAuditService.findAll.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
      const query = { action: 'reindex', actor: 'GABC', from: '2024-01-01', to: '2024-01-31', limit: 10 };
      await controller.getAudits(query as never, adminReq());
      expect(mockAuditService.findAll).toHaveBeenCalledWith(query);
    });
  });

  // ── GET /admin/audits/export ─────────────────────────────────────────────

  describe('GET /admin/audits/export', () => {
    it('streams CSV and writes meta-audit', async () => {
      mockAuditService.streamCsv.mockResolvedValue(undefined);
      const res = { setHeader: jest.fn(), write: jest.fn(), end: jest.fn() } as unknown as Response;
      const query = { action: 'reindex' };

      await controller.exportAudits(query as never, adminReq(), res);

      expect(mockAuditService.streamCsv).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reindex' }),
        res,
      );
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'GADMIN', action: 'audit_log_export' }),
      );
    });
  });

  // ── PATCH /admin/feature-flags/:key ─────────────────────────────────────

  describe('PATCH /admin/feature-flags/:key', () => {
    it('updates flag and writes audit row', async () => {
      const flag = { key: 'claims_enabled', enabled: false, updatedBy: 'GADMIN' };
      mockAdminService.setFeatureFlag.mockResolvedValue(flag);
      const result = await controller.setFeatureFlag(
        'claims_enabled',
        { enabled: false },
        adminReq(),
      );
      expect(result).toEqual(flag);
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'feature_flag_update',
          payload: expect.objectContaining({ key: 'claims_enabled', enabled: false }),
        }),
      );
    });
  });

  // ── POST /admin/queues/:queue/jobs/:jobId/retry ──────────────────────────

  describe('POST /admin/queues/:queue/jobs/:jobId/retry', () => {
    it('replays job and writes audit row', async () => {
      mockQueueMonitorService.replayJob.mockResolvedValue('job-99');
      const result = await controller.retryDlqJob('indexer', 'job-99', adminReq());
      expect(result).toEqual({ queue: 'indexer', jobId: 'job-99', status: 'retried' });
      expect(mockQueueMonitorService.replayJob).toHaveBeenCalledWith('indexer', 'job-99');
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'dlq_job_replayed',
          payload: expect.objectContaining({ queue: 'indexer', jobId: 'job-99' }),
        }),
      );
    });
  });

  // ── Role guard — unauthorized access ────────────────────────────────────

  describe('Role guard — non-admin access denied', () => {
    it('throws ForbiddenException for support_readonly role', () => {
      const guard = new AdminRoleGuard();
      const ctx = toExecutionContext('support_readonly');
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when no user present', () => {
      const guard = new AdminRoleGuard();
      const ctx = toExecutionContext();
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('allows admin role through', () => {
      const guard = new AdminRoleGuard();
      const ctx = toExecutionContext('admin');
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('throws ForbiddenException for viewer role', () => {
      const guard = new AdminRoleGuard();
      const ctx = toExecutionContext('viewer');
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });
});

// ── Admin Role Guard Enforcement Tests ───────────────────────────────────────

describe('Admin Role Guard Enforcement', () => {
  let controller: AdminController;
  let module: TestingModule;

  const mockReq = (role?: string, authenticated = true) =>
    ({
      user: authenticated ? { walletAddress: 'GTEST', role } : undefined,
      ip: '127.0.0.1',
    } as unknown as Request);

  beforeEach(async () => {
    jest.clearAllMocks();
    
    module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: AdminPoliciesService, useValue: mockAdminPoliciesService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrivacyService, useValue: { handleRequest: jest.fn(), listRequests: jest.fn() } },
        { provide: RateLimitService, useValue: { setLimit: jest.fn(), getCounterState: jest.fn(), enableOverride: jest.fn(), disableOverride: jest.fn() } },
        { provide: QueueMonitorService, useValue: mockQueueMonitorService },
        {
          provide: 'SolvencyMonitoringService',
          useValue: mockSolvencyMonitoringService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminRoleGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          if (!req.user) {
            throw new UnauthorizedException('Authentication required');
          }
          if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin role required');
          }
          return true;
        },
      })
      .compile();

    controller = module.get<AdminController>(AdminController);
    (controller as unknown as Record<string, unknown>)['solvencyMonitoringService'] =
      mockSolvencyMonitoringService;
  });

  afterAll(async () => {
    await module.close();
  });

  describe('Authentication Required', () => {
    it('should reject unauthenticated requests to POST /admin/reindex', async () => {
      await expect(controller.reindex({ fromLedger: 500 }, mockReq(undefined, false)))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should reject unauthenticated requests to GET /admin/audits', async () => {
      await expect(controller.getAudits({}, mockReq(undefined, false)))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should reject unauthenticated requests to GET /admin/policies', async () => {
      await expect(controller.getAdminPolicies('false', mockReq(undefined, false)))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should reject unauthenticated requests to GET /admin/feature-flags', async () => {
      await expect(controller.listFeatureFlags(mockReq(undefined, false)))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Admin Role Required', () => {
    it('should reject non-admin users from POST /admin/reindex', async () => {
      await expect(controller.reindex({ fromLedger: 500 }, mockReq('user')))
        .rejects.toThrow(ForbiddenException);
    });

    it('should reject non-admin users from GET /admin/audits', async () => {
      await expect(controller.getAudits({}, mockReq('user')))
        .rejects.toThrow(ForbiddenException);
    });

    it('should reject non-admin users from GET /admin/policies', async () => {
      await expect(controller.getAdminPolicies('false', mockReq('user')))
        .rejects.toThrow(ForbiddenException);
    });

    it('should reject non-admin users from GET /admin/feature-flags', async () => {
      await expect(controller.listFeatureFlags(mockReq('user')))
        .rejects.toThrow(ForbiddenException);
    });

    it('should reject staff users without admin role', async () => {
      const staffReq = mockReq('staff');
      
      await expect(controller.reindex({ fromLedger: 500 }, staffReq))
        .rejects.toThrow(ForbiddenException);
      
      await expect(controller.getAudits({}, staffReq))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('Admin Access Success', () => {
    it('should allow admin users to access all endpoints', async () => {
      const adminReq = mockReq('admin');
      
      // Mock successful responses
      mockAdminService.enqueueReindex.mockResolvedValue('job-123');
      mockAdminService.getFeatureFlags.mockResolvedValue([]);
      mockAdminPoliciesService.listPolicies.mockResolvedValue({ policies: [] });
      mockAuditService.findAll.mockResolvedValue({ items: [], pagination: {} });
      
      // These should not throw
      await expect(controller.reindex({ fromLedger: 500 }, adminReq))
        .resolves.toBeDefined();
      
      await expect(controller.getAudits({}, adminReq))
        .resolves.toBeDefined();
      
      await expect(controller.listFeatureFlags(adminReq))
        .resolves.toBeDefined();
      
      await expect(controller.getAdminPolicies('false', adminReq))
        .resolves.toBeDefined();
    });
  });
});
