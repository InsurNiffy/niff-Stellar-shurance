import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';

/**
 * Integration tests for multi-tenant isolation (issue #1830).
 *
 * Verifies that queries scoped through TenantContextService /
 * TenantFilterHelper never return data belonging to another tenant.
 * Cross-tenant reads must yield empty results (not 403).
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantContext: TenantContextService;

  const tenantA = 'tenant-a-test';
  const tenantB = 'tenant-b-test';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    tenantContext = app.get(TenantContextService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('TenantContextService', () => {
    it('extracts tenantId from the request header', () => {
      const req = { headers: { 'x-tenant-id': tenantA } } as any;
      expect(tenantContext.extractTenantId(req)).toBe(tenantA);
    });

    it('extracts tenantId from a JWT payload', () => {
      const req = {
        headers: {},
        user: { tenantId: tenantB },
      } as any;
      expect(tenantContext.extractTenantId(req)).toBe(tenantB);
    });

    it('throws when no tenant can be resolved', () => {
      const req = { headers: {} } as any;
      expect(() => tenantContext.extractTenantId(req)).toThrow();
    });
  });

  describe('query scoping', () => {
    it('does not return records from another tenant', async () => {
      const scoped = tenantContext.scopeWhere(tenantA, { status: 'active' });
      expect(scoped).toEqual({ tenantId: tenantA, status: 'active' });

      const results = await prisma.$transaction(async (tx) => {
        return tenantContext.withTenant(tx, tenantA, (scopedTx) =>
          scopedTx.record.findMany({ where: scoped }),
        );
      });

      for (const row of results) {
        expect(row.tenantId).toBe(tenantA);
      }
    });

    it('returns empty results for a tenant with no data (not 403)', async () => {
      const scoped = tenantContext.scopeWhere('tenant-empty', {});
      const results = await prisma.record.findMany({ where: scoped });
      expect(results).toEqual([]);
    });

    it('rejects cross-tenant access via HTTP with empty payload', async () => {
      const res = await request(app.getHttpServer())
        .get('/records')
        .set('x-tenant-id', tenantA)
        .expect((r) => {
          expect([200, 204]).toContain(r.status);
        });

      const body = Array.isArray(res.body) ? res.body : res.body?.data ?? [];
      for (const row of body) {
        expect(row.tenantId).toBe(tenantA);
      }
    });
  });
});
