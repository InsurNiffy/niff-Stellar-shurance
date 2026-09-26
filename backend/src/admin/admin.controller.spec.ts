import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminPoliciesService } from './admin-policies.service';
import { AdminClaimsExportService } from './admin-claims-export.service';
import { AuditService } from './audit.service';
import { PrivacyService } from '../maintenance/privacy.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { QueueMonitorService } from '../queues/queue-monitor.service';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SolvencyMonitoringService } from '../maintenance/solvency-monitoring.service';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminStatsService } from './admin-stats.service';
import { SorobanService } from '../rpc/soroban.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { SupportService } from '../support/support.service';
import { CommentRepository } from '../claims/comments/comment.repository';
import { TenantConfigAuditService } from '../tenant/tenant-config-audit.service';

const mockSorobanService = {
  simulateGetEvidenceLimits: jest.fn(),
  invokeAdminSetEvidenceLimits: jest.fn(),
  buildBatchRegisterVotersTransaction: jest.fn(),
  buildRemoveVoterTransaction: jest.fn(),
  simulateGetQuorumBps: jest.fn(),
  buildSetQuorumBpsTransaction: jest.fn(),
};

const mockAdminService = {
  enqueueReindex: jest.fn(),
  enqueueBackfill: jest.fn(),
  getBackfillJob: jest.fn(),
  setFeatureFlag: jest.fn(),
  getFeatureFlags: jest.fn(),
  bulkSetFeatureFlags: jest.fn(),
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
const mockAdminStatsService = {
  getStats: jest.fn(),
};
const mockAdminAnalyticsService = {
  getRenewalAnalytics: jest.fn(),
  getSupportAnalytics: jest.fn(),
};
const mockAdminTenantsService = {
  listTenants: jest.fn(),
};
const mockPrismaService = {
  holderProfile: {
    findMany: jest.fn(),
  },
  registeredVoter: { findMany: jest.fn() },
  claim: { findMany: jest.fn() },
};
const mockAdminClaimsExportService = {
  streamCsv: jest.fn(),
};
const mockTokenBlacklistService = {
  isBlacklisted: jest.fn(),
  blacklist: jest.fn(),
};
const mockSupportService = {
  listTickets: jest.fn(),
  getTicket: jest.fn(),
};
const mockCommentRepository = {
  findByClaimId: jest.fn(),
};
const mockTenantConfigAuditService = {
  getHistory: jest.fn(),
};

const adminReq = (role = 'admin', scopes: string[] = ['admin:claims:override']) =>
  ({
    user: { walletAddress: 'GADMIN', role, scopes },
    adminIdentity: { email: 'admin@niffyinsure.test', role, scopes },
    ip: '127.0.0.1',
  } as unknown as Request);

const toExecutionContext = (role?: string): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => (role ? { user: { role }, ip: '127.0.0.1' } : { ip: '127.0.0.1' }),
    }),
    getArgByIndex: () => undefined,
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
          provide: SolvencyMonitoringService,
          useValue: mockSolvencyMonitoringService,
        },
        { provide: AdminStatsService, useValue: mockAdminStatsService },
        { provide: AdminAnalyticsService, useValue: mockAdminAnalyticsService },
        { provide: AdminTenantsService, useValue: mockAdminTenantsService },
        { provide: require('../prisma/prisma.service').PrismaService, useValue: mockPrismaService },
        { provide: SorobanService, useValue: mockSorobanService },
        { provide: AdminClaimsExportService, useValue: mockAdminClaimsExportService },
        { provide: TokenBlacklistService, useValue: mockTokenBlacklistService },
        { provide: SupportService, useValue: mockSupportService },
        { provide: CommentRepository, useValue: mockCommentRepository },
        { provide: TenantConfigAuditService, useValue: mockTenantConfigAuditService },
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

  describe('POST /admin/indexer/backfill', () => {
    it('enqueues batched jobs and writes audit row', async () => {
      const mockJobs = [
        { jobId: 'backfill-testnet-100-149-ts-0', fromLedger: 100, toLedger: 149, batchSize: 50 },
        { jobId: 'backfill-testnet-150-199-ts-1', fromLedger: 150, toLedger: 199, batchSize: 50 },
      ];
      mockAdminService.enqueueBackfill.mockResolvedValue(mockJobs);

      const result = await controller.enqueueBackfill(
        { fromLedger: 100, toLedger: 199 },
        adminReq(),
      );

      expect(result).toMatchObject({
        fromLedger: 100,
        toLedger: 199,
        network: 'testnet',
        batchSize: 50,
        status: 'queued',
        jobs: mockJobs,
      });
      expect(mockAdminService.enqueueBackfill).toHaveBeenCalledWith(100, 199, 'testnet', 50);
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'GADMIN',
          action: 'indexer_backfill',
          payload: expect.objectContaining({ fromLedger: 100, toLedger: 199, network: 'testnet' }),
        }),
      );
    });

    it('rejects when fromLedger > toLedger', async () => {
      await expect(
        controller.enqueueBackfill({ fromLedger: 200, toLedger: 100 }, adminReq()),
      ).rejects.toThrow('fromLedger must be <= toLedger');
      expect(mockAdminService.enqueueBackfill).not.toHaveBeenCalled();
    });

    it('rejects when range exceeds MAX_BACKFILL_LEDGER_RANGE', async () => {
      // mockConfigService returns undefined for unknown keys, so maxRange defaults to 100_000
      // We need a range > 100_000
      await expect(
        controller.enqueueBackfill({ fromLedger: 1, toLedger: 200_001 }, adminReq()),
      ).rejects.toThrow(/exceeds MAX_BACKFILL_LEDGER_RANGE/);
      expect(mockAdminService.enqueueBackfill).not.toHaveBeenCalled();
    });

    it('uses explicit network when provided', async () => {
      mockAdminService.enqueueBackfill.mockResolvedValue([]);
      await controller.enqueueBackfill(
        { fromLedger: 100, toLedger: 149, network: 'mainnet' },
        adminReq(),
      );
      expect(mockAdminService.enqueueBackfill).toHaveBeenCalledWith(100, 149, 'mainnet', 50);
    });
  });

  // ── GET /admin/indexer/backfill/:jobId ───────────────────────────────────

  describe('GET /admin/indexer/backfill/:jobId', () => {
    it('returns job status when found', async () => {
      const mockJob = {
        jobId: 'backfill-testnet-100-149-ts-0',
        state: 'completed',
        data: { fromLedger: 100, toLedger: 149, network: 'testnet', batchSize: 50 },
        progress: 0,
      };
      mockAdminService.getBackfillJob.mockResolvedValue(mockJob);

      const result = await controller.getBackfillJob('backfill-testnet-100-149-ts-0');
      expect(result).toEqual(mockJob);
      expect(mockAdminService.getBackfillJob).toHaveBeenCalledWith('backfill-testnet-100-149-ts-0');
    });

    it('throws NotFoundException when job not found', async () => {
      mockAdminService.getBackfillJob.mockResolvedValue(null);
      await expect(controller.getBackfillJob('nonexistent')).rejects.toThrow('not found');
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

  // ── POST /admin/feature-flags/bulk ──────────────────────────────────────

  describe('POST /admin/feature-flags/bulk', () => {
    it('applies updates atomically and writes a single audit row', async () => {
      const updates = [
        { key: 'claims_enabled', enabled: false },
        { key: 'voting_enabled', enabled: true },
      ];
      mockAdminService.bulkSetFeatureFlags.mockResolvedValue(updates);

      const result = await controller.bulkSetFeatureFlags(
        { updates },
        adminReq(),
      );

      expect(result).toEqual({ updated: updates });
      expect(mockAdminService.bulkSetFeatureFlags).toHaveBeenCalledWith(updates, 'GADMIN');
      expect(mockAuditService.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'feature_flag_bulk_update',
          payload: expect.objectContaining({ count: 2 }),
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
    const makeReflector = (minRole = 'admin') =>
      ({
        get: jest.fn().mockReturnValue(false),
        getAllAndOverride: jest.fn().mockReturnValue(minRole),
      }) as unknown as import('@nestjs/core').Reflector;

    const makeGuard = () => {
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue(null),
      } as unknown as import('../auth/auth-identity.service').AuthIdentityService;
      return new AdminRoleGuard(makeReflector(), mockAuthIdentity);
    };

    it('throws ForbiddenException when no user present', async () => {
      const guard = makeGuard();
      const ctx = toExecutionContext();
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for non-admin identity', async () => {
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'viewer', scopes: [] }),
      } as unknown as import('../auth/auth-identity.service').AuthIdentityService;
      const guard = new AdminRoleGuard(makeReflector('admin'), mockAuthIdentity);
      const ctx = toExecutionContext('viewer');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('allows admin role through', async () => {
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'admin', scopes: [] }),
      } as unknown as import('../auth/auth-identity.service').AuthIdentityService;
      const guard = new AdminRoleGuard(makeReflector('admin'), mockAuthIdentity);
      const ctx = toExecutionContext('admin');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
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
          provide: SolvencyMonitoringService,
          useValue: mockSolvencyMonitoringService,
        },
        { provide: AdminStatsService, useValue: mockAdminStatsService },
        { provide: AdminAnalyticsService, useValue: mockAdminAnalyticsService },
        { provide: AdminTenantsService, useValue: mockAdminTenantsService },
        { provide: require('../prisma/prisma.service').PrismaService, useValue: mockPrismaService },
        { provide: SorobanService, useValue: mockSorobanService },
        { provide: AdminClaimsExportService, useValue: mockAdminClaimsExportService },
        { provide: TokenBlacklistService, useValue: mockTokenBlacklistService },
        { provide: SupportService, useValue: mockSupportService },
        { provide: CommentRepository, useValue: mockCommentRepository },
        { provide: TenantConfigAuditService, useValue: mockTenantConfigAuditService },
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
    it('controller methods work when guard allows (mocked guard)', async () => {
      mockAdminService.enqueueReindex.mockResolvedValue('job-1');
      await expect(controller.reindex({ fromLedger: 500 }, mockReq('admin')))
        .resolves.toBeDefined();
    });
  });

  describe('Admin Role Required', () => {
    const makeGuardCtx = () => ({
      getHandler: () => ({}),
      getClass: () => ({}),
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ ip: '127.0.0.1' }) }),
      getArgByIndex: () => undefined,
      // getAllAndOverride mock handled by reflector below
    });

    it('viewer is rejected on default (admin-level) endpoint', async () => {
      const mockReflector = {
        get: jest.fn().mockReturnValue(false),
        getAllAndOverride: jest.fn().mockReturnValue('admin'),
      };
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'viewer', scopes: [] }),
      };
      const guard = new AdminRoleGuard(mockReflector as any, mockAuthIdentity as any);
      await expect(guard.canActivate(makeGuardCtx() as any)).rejects.toThrow(ForbiddenException);
    });

    it('viewer is allowed on viewer-level endpoint', async () => {
      const mockReflector = {
        get: jest.fn().mockReturnValue(false),
        getAllAndOverride: jest.fn().mockReturnValue('viewer'),
      };
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'viewer', scopes: [] }),
      };
      const guard = new AdminRoleGuard(mockReflector as any, mockAuthIdentity as any);
      await expect(guard.canActivate(makeGuardCtx() as any)).resolves.toBe(true);
    });

    it('admin is rejected on superadmin-level endpoint', async () => {
      const mockReflector = {
        get: jest.fn().mockReturnValue(false),
        getAllAndOverride: jest.fn().mockReturnValue('superadmin'),
      };
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'admin', scopes: [] }),
      };
      const guard = new AdminRoleGuard(mockReflector as any, mockAuthIdentity as any);
      await expect(guard.canActivate(makeGuardCtx() as any)).rejects.toThrow(ForbiddenException);
    });

    it('superadmin passes all levels', async () => {
      for (const minRole of ['viewer', 'admin', 'superadmin']) {
        const mockReflector = {
          get: jest.fn().mockReturnValue(false),
          getAllAndOverride: jest.fn().mockReturnValue(minRole),
        };
        const mockAuthIdentity = {
          resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'superadmin', scopes: [] }),
        };
        const guard = new AdminRoleGuard(mockReflector as any, mockAuthIdentity as any);
        await expect(guard.canActivate(makeGuardCtx() as any)).resolves.toBe(true);
      }
    });

    it('support_readonly is treated as viewer (backwards compat)', async () => {
      const mockReflector = {
        get: jest.fn().mockReturnValue(false),
        getAllAndOverride: jest.fn().mockReturnValue('viewer'),
      };
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'support_readonly', scopes: [] }),
      };
      const guard = new AdminRoleGuard(mockReflector as any, mockAuthIdentity as any);
      await expect(guard.canActivate(makeGuardCtx() as any)).resolves.toBe(true);
    });

    it('guard rejects non-admin role (unit test)', async () => {
      const mockReflector = {
        get: jest.fn().mockReturnValue(false),
        getAllAndOverride: jest.fn().mockReturnValue('admin'),
      };
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'viewer' }),
      };
      const guard = new AdminRoleGuard(mockReflector as any, mockAuthIdentity as any);
      const ctx = {
        getHandler: () => ({}), getClass: () => ({}), getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => ({ ip: '127.0.0.1' }) }),
        getArgByIndex: () => undefined,
      } as any;
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('should reject staff users without admin role (guard unit test)', async () => {
      const mockReflector = {
        get: jest.fn().mockReturnValue(false),
        getAllAndOverride: jest.fn().mockReturnValue('admin'),
      };
      const mockAuthIdentity = {
        resolveRequestIdentity: jest.fn().mockResolvedValue({ kind: 'staff', staffId: 's1', email: 'a@b.com', role: 'viewer' }),
      };
      const guard = new AdminRoleGuard(mockReflector as any, mockAuthIdentity as any);
      const ctx = {
        getHandler: () => ({}), getClass: () => ({}), getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => ({ ip: '127.0.0.1' }) }),
        getArgByIndex: () => undefined,
      } as any;
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
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

      await expect(controller.getAudits({ limit: 20 } as never, adminReq))
        .resolves.toBeDefined();

      await expect(controller.listFeatureFlags())
        .resolves.toBeDefined();

      await expect(controller.getAdminPolicies('false'))
        .resolves.toBeDefined();
    });
  });

  // ── GET /admin/users ─────────────────────────────────────────────────────

  describe('GET /admin/users', () => {
    const profiles = [
      { walletAddress: 'GA1', displayName: 'Alice', email: null, locale: 'en', createdAt: new Date(), lastSeenAt: new Date() },
      { walletAddress: 'GA2', displayName: null,    email: null, locale: 'en', createdAt: new Date(), lastSeenAt: null },
    ];

    it('returns all profiles ordered by lastSeenAt', async () => {
      mockPrismaService.holderProfile.findMany.mockResolvedValue(profiles);
      const result = await controller.listUsers();
      expect(result).toEqual(profiles);
      expect(mockPrismaService.holderProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ lastSeenAt: 'desc' }, { walletAddress: 'asc' }] }),
      );
    });

    it('filters by dormantDays when provided', async () => {
      mockPrismaService.holderProfile.findMany.mockResolvedValue([profiles[1]]);
      const result = await controller.listUsers('30');
      expect(result).toEqual([profiles[1]]);
      const call = mockPrismaService.holderProfile.findMany.mock.calls[0][0];
      expect(call.where).toHaveProperty('OR');
    });

    it('respects limit cap of 500', async () => {
      mockPrismaService.holderProfile.findMany.mockResolvedValue([]);
      await controller.listUsers(undefined, '1000');
      const call = mockPrismaService.holderProfile.findMany.mock.calls[0][0];
      expect(call.take).toBe(500);
    });
  });
});
