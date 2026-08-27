/**
 * #1331 — Appeal flow end-to-end integration test
 *
 * Covers the full appeal path:
 *   1. Build an unsigned file_appeal transaction XDR (mocked Soroban build).
 *   2. Submit the signed appeal with an idempotency txHash → DB row moves to UNDER_APPEAL.
 *   3. Idempotency guard: a retry with the same txHash returns the cached result
 *      without incrementing appealsCount a second time.
 *   4. Indexer decode path: simulate an appeal_approved event → DB moves to APPROVED.
 *   5. Indexer decode path: simulate an appeal_rejected event → DB moves to REJECTED.
 *   6. Admin force-finalize: POST /admin/claims/:id/finalize-appeal on an UNDER_APPEAL
 *      claim writes an audit row (Soroban call is mocked).
 *
 * External dependencies (Soroban RPC, real keypairs) are mocked so the test
 * runs in the Testcontainers Postgres + Redis environment with no real network calls.
 */

/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MetricsService } from '../../src/metrics/metrics.service';
import { SorobanService } from '../../src/rpc/soroban.service';
import { IndexerService } from '../../src/indexer/indexer.service';
import { mintUserToken, mintAdminToken } from '../helpers/jwt';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** Syntactically valid Stellar test key (not a real keypair). */
const CLAIMANT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ADMIN    = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

/** Unique IDs to avoid collisions with other e2e suites. */
const APPEAL_CLAIM_ID  = 88881; // appeal flow + idempotency test
const APPEAL_CLAIM_ID2 = 88882; // appeal_approved indexer decode
const APPEAL_CLAIM_ID3 = 88883; // appeal_rejected indexer decode
const APPEAL_CLAIM_ID4 = 88884; // admin force-finalize

const POLICY_ID = `${CLAIMANT}:88`;

/**
 * A minimal fake signed XDR — SorobanService.submitTransaction is mocked so
 * the value is never sent to the network. We only need a non-empty string.
 */
const FAKE_SIGNED_XDR = 'AAAAAgAAAABmfake_xdr_for_testing==';

/** Idempotency key (SHA-256 of the XDR in a real client — here a fixed string). */
const IDEMPOTENCY_TX_HASH = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Seed a policy + claim row so the service can find them. */
async function seedPolicyAndClaim(
  prisma: PrismaService,
  claimId: number,
  status: string,
): Promise<void> {
  await prisma.policy.upsert({
    where: { id: POLICY_ID },
    create: {
      id: POLICY_ID,
      policyId: 88,
      holderAddress: CLAIMANT,
      policyType: 'test',
      region: 'test',
      coverageAmount: '1000',
      premium: '10',
      startLedger: 1,
      endLedger: 999999,
    },
    update: {},
  });

  await prisma.claim.upsert({
    where: { id: claimId },
    create: {
      id: claimId,
      policyId: POLICY_ID,
      creatorAddress: CLAIMANT,
      amount: '500',
      description: 'Test claim for appeal e2e',
      status: status as 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'UNDER_APPEAL',
      approveVotes: 0,
      rejectVotes: 0,
      createdAtLedger: 1000,
      updatedAtLedger: 1000,
    },
    update: { status: status as 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'UNDER_APPEAL' },
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Appeal flow (E2E #1331)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let metrics: MetricsService;
  let soroban: SorobanService;
  let indexer: IndexerService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma  = moduleFixture.get(PrismaService);
    metrics = moduleFixture.get(MetricsService);
    soroban = moduleFixture.get(SorobanService);
    indexer = moduleFixture.get(IndexerService);

    // ── Mock SorobanService methods so no real network calls are made ────────
    jest.spyOn(soroban, 'buildAppealTransaction').mockResolvedValue({
      unsignedXdr: 'AAAAA_MOCK_UNSIGNED_XDR==',
      minResourceFee: '100',
      baseFee: '100',
      totalEstimatedFee: '200',
      totalEstimatedFeeXlm: '0.0000200',
      authRequirements: [{ address: CLAIMANT, isContract: false }],
      memoConvention: 'mock',
      currentLedger: 5000,
    });

    jest.spyOn(soroban, 'submitTransaction').mockResolvedValue({
      status: 'PENDING',
      hash: IDEMPOTENCY_TX_HASH,
    } as never);

    jest.spyOn(soroban, 'finalizeAppeal').mockResolvedValue({
      txHash: 'deadbeef0000000000000000000000000000000000000000000000000000cafe',
      ledger: 9999,
      onChainStatus: 'Approved',
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    // Clean up seeded rows
    for (const id of [APPEAL_CLAIM_ID, APPEAL_CLAIM_ID2, APPEAL_CLAIM_ID3, APPEAL_CLAIM_ID4]) {
      await prisma.claim.deleteMany({ where: { id } });
    }
    await prisma.policy.deleteMany({ where: { id: POLICY_ID } });
    await app.close();
  });

  // ── 1. Build unsigned appeal XDR ──────────────────────────────────────────

  describe('POST /api/claims/:id/appeal/build-transaction', () => {
    beforeAll(() => seedPolicyAndClaim(prisma, APPEAL_CLAIM_ID, 'REJECTED'));

    it('returns 401 without a JWT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/claims/${APPEAL_CLAIM_ID}/appeal/build-transaction`)
        .send({ claimant: CLAIMANT, claimId: APPEAL_CLAIM_ID, reason: 'New evidence' });

      expect(res.status).toBe(401);
    });

    it('returns unsigned XDR + fee estimates for a valid request', async () => {
      const token = mintUserToken(CLAIMANT);

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${APPEAL_CLAIM_ID}/appeal/build-transaction`)
        .set('Authorization', `Bearer ${token}`)
        .send({ claimant: CLAIMANT, claimId: APPEAL_CLAIM_ID, reason: 'New evidence' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        unsignedXdr: expect.any(String),
        totalEstimatedFee: expect.any(String),
        authRequirements: expect.arrayContaining([
          expect.objectContaining({ address: CLAIMANT }),
        ]),
      });
    });

    it('returns 400 when reason is missing', async () => {
      const token = mintUserToken(CLAIMANT);

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${APPEAL_CLAIM_ID}/appeal/build-transaction`)
        .set('Authorization', `Bearer ${token}`)
        .send({ claimant: CLAIMANT, claimId: APPEAL_CLAIM_ID }); // no reason

      expect(res.status).toBe(400);
    });
  });

  // ── 2. Submit appeal → DB moves to UNDER_APPEAL ───────────────────────────

  describe('POST /api/claims/:id/appeal (first submission)', () => {
    it('returns 401 without a JWT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/claims/${APPEAL_CLAIM_ID}/appeal`)
        .send({ transactionXdr: FAKE_SIGNED_XDR, txHash: IDEMPOTENCY_TX_HASH });

      expect(res.status).toBe(401);
    });

    it('returns 200 and sets status to UNDER_APPEAL on first submission', async () => {
      const token = mintUserToken(CLAIMANT);

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${APPEAL_CLAIM_ID}/appeal`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transactionXdr: FAKE_SIGNED_XDR, txHash: IDEMPOTENCY_TX_HASH });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ cached: false, claimId: APPEAL_CLAIM_ID });

      // Verify DB row was updated
      const claim = await prisma.claim.findUnique({ where: { id: APPEAL_CLAIM_ID } });
      expect(claim?.status).toBe('UNDER_APPEAL');
      expect(claim?.appealTxHash).toBe(IDEMPOTENCY_TX_HASH);
      expect(claim?.appealsCount).toBe(1);
    });
  });

  // ── 3. Idempotency guard — retry must not double-count ────────────────────

  describe('POST /api/claims/:id/appeal (retry with same txHash)', () => {
    it('returns cached result without re-incrementing appealsCount', async () => {
      const token = mintUserToken(CLAIMANT);

      const res = await request(app.getHttpServer())
        .post(`/api/claims/${APPEAL_CLAIM_ID}/appeal`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transactionXdr: FAKE_SIGNED_XDR, txHash: IDEMPOTENCY_TX_HASH });

      expect(res.status).toBe(200);
      // The guard returns the cached result
      expect(res.body).toMatchObject({ cached: true, claimId: APPEAL_CLAIM_ID });

      // appealsCount must still be 1 — not 2
      const claim = await prisma.claim.findUnique({ where: { id: APPEAL_CLAIM_ID } });
      expect(claim?.appealsCount).toBe(1);
    });

    it('soroban.submitTransaction was called exactly once (not on retry)', () => {
      // submitTransaction mock was called for the first submission only
      expect(soroban.submitTransaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── 4. Indexer decode — appeal_approved event ─────────────────────────────

  describe('Indexer: appeal_approved event → DB status = APPROVED', () => {
    beforeAll(() => seedPolicyAndClaim(prisma, APPEAL_CLAIM_ID2, 'UNDER_APPEAL'));

    it('updates the claim to APPROVED and records the metric', async () => {
      // Spy on the metric before triggering the handler
      const approvedSpy = jest.spyOn(metrics, 'recordAppealApproved');

      // Call the private handler via the indexer's internal method (white-box integration)
      // @ts-expect-error — accessing private method for test coverage
      await (indexer as unknown as { handleAppealResolved: (...a: unknown[]) => Promise<void> }).handleAppealResolved(
        prisma,
        { claim_id: APPEAL_CLAIM_ID2 },
        {
          ledger: 6000,
          ledgerClosedAt: new Date().toISOString(),
          txHash: 'aaa111',
        },
        'APPROVED',
      );

      const claim = await prisma.claim.findUnique({ where: { id: APPEAL_CLAIM_ID2 } });
      expect(claim?.status).toBe('APPROVED');
      expect(claim?.isFinalized).toBe(true);

      expect(approvedSpy).toHaveBeenCalledTimes(1);
      approvedSpy.mockRestore();
    });
  });

  // ── 5. Indexer decode — appeal_rejected event ─────────────────────────────

  describe('Indexer: appeal_rejected event → DB status = REJECTED', () => {
    beforeAll(() => seedPolicyAndClaim(prisma, APPEAL_CLAIM_ID3, 'UNDER_APPEAL'));

    it('updates the claim to REJECTED and records the metric', async () => {
      const rejectedSpy = jest.spyOn(metrics, 'recordAppealRejected');

      // @ts-expect-error — accessing private method for test coverage
      await (indexer as unknown as { handleAppealResolved: (...a: unknown[]) => Promise<void> }).handleAppealResolved(
        prisma,
        { claim_id: APPEAL_CLAIM_ID3 },
        {
          ledger: 6001,
          ledgerClosedAt: new Date().toISOString(),
          txHash: 'bbb222',
        },
        'REJECTED',
      );

      const claim = await prisma.claim.findUnique({ where: { id: APPEAL_CLAIM_ID3 } });
      expect(claim?.status).toBe('REJECTED');
      expect(claim?.isFinalized).toBe(true);

      expect(rejectedSpy).toHaveBeenCalledTimes(1);
      rejectedSpy.mockRestore();
    });
  });

  // ── 6. Admin force-finalize stalled appeal ────────────────────────────────

  describe('POST /api/admin/claims/:id/finalize-appeal', () => {
    beforeAll(() => seedPolicyAndClaim(prisma, APPEAL_CLAIM_ID4, 'UNDER_APPEAL'));

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/claims/${APPEAL_CLAIM_ID4}/finalize-appeal`);

      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin user', async () => {
      const userToken = mintUserToken(CLAIMANT);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/claims/${APPEAL_CLAIM_ID4}/finalize-appeal`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns 400 when claim is not UNDER_APPEAL', async () => {
      // Seed a PENDING claim (wrong status)
      await seedPolicyAndClaim(prisma, APPEAL_CLAIM_ID4, 'PENDING');

      const adminToken = mintAdminToken(ADMIN);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/claims/${APPEAL_CLAIM_ID4}/finalize-appeal`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code ?? res.body.message).toMatch(/CLAIM_NOT_UNDER_APPEAL|not in UNDER_APPEAL/i);

      // Reset to UNDER_APPEAL for next test
      await seedPolicyAndClaim(prisma, APPEAL_CLAIM_ID4, 'UNDER_APPEAL');
    });

    it('calls finalizeAppeal and writes an audit log entry', async () => {
      const adminToken = mintAdminToken(ADMIN);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/claims/${APPEAL_CLAIM_ID4}/finalize-appeal`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        claimId: APPEAL_CLAIM_ID4,
        txHash: expect.any(String),
        ledger: expect.any(Number),
        onChainStatus: expect.any(String),
      });

      // Verify the finalizeAppeal mock was called with the correct claimId
      expect(soroban.finalizeAppeal).toHaveBeenCalledWith(APPEAL_CLAIM_ID4);

      // Verify an immutable audit log row was written
      const auditRows = await prisma.adminAuditLog.findMany({
        where: {
          action: 'admin_finalize_appeal',
          payload: { path: ['claimId'], equals: APPEAL_CLAIM_ID4 },
        },
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const auditRow = auditRows[0];
      expect(auditRow.payload).toMatchObject({
        claimId: APPEAL_CLAIM_ID4,
        txHash: expect.any(String),
      });
    });

    it('returns 404 for a non-existent claim', async () => {
      const adminToken = mintAdminToken(ADMIN);

      const res = await request(app.getHttpServer())
        .post('/api/admin/claims/999999/finalize-appeal')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ── 7. Metrics endpoint exposes appeal counters ───────────────────────────

  describe('GET /api/metrics (appeal counters visible)', () => {
    it('exposes appeals_opened_total in the Prometheus output', async () => {
      const res = await request(app.getHttpServer()).get('/api/metrics');

      // Metrics endpoint may require METRICS_TOKEN — skip auth check here
      // and just assert the metric name is registered in the prom-client registry
      const metricsOutput = await metrics.getMetrics();
      expect(metricsOutput).toContain('appeals_opened_total');
      expect(metricsOutput).toContain('appeals_approved_total');
      expect(metricsOutput).toContain('appeals_rejected_total');
      expect(metricsOutput).toContain('appeals_in_flight');

      // res may be 200 or 401 depending on METRICS_TOKEN env — either is fine
      expect([200, 401, 403]).toContain(res.status);
    });
  });
});
