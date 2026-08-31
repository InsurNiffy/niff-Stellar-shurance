/**
 * Integration tests for claim comments endpoints:
 *   GET    /api/claims/:id/comments
 *   POST   /api/claims/:id/comments
 *   DELETE /api/claims/:id/comments/:commentId
 */

/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { mintUserToken, mintAdminToken } from '../helpers/jwt';

const WALLET_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const WALLET_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('Claim Comments (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let claimId: number;

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

    prisma = moduleFixture.get(PrismaService);

    // Seed a minimal policy + claim for tests
    await prisma.policy.upsert({
      where: { id: `${WALLET_A}:1` },
      create: {
        id: `${WALLET_A}:1`,
        policyId: 1,
        holderAddress: WALLET_A,
        policyType: 'test',
        region: 'test',
        coverageAmount: '1000',
        premium: '10',
        startLedger: 1,
        endLedger: 999999,
      },
      update: {},
    });

    const claim = await prisma.claim.upsert({
      where: { id: 9999 },
      create: {
        id: 9999,
        policyId: `${WALLET_A}:1`,
        creatorAddress: WALLET_A,
        amount: '500',
        createdAtLedger: 1,
      },
      update: {},
    });
    claimId = claim.id;
  });

  afterAll(async () => {
    await prisma.claimComment.deleteMany({ where: { claimId } });
    await prisma.claim.deleteMany({ where: { id: claimId } });
    await prisma.policy.deleteMany({ where: { id: `${WALLET_A}:1` } });
    await app.close();
  });

  afterEach(async () => {
    await prisma.claimComment.deleteMany({ where: { claimId } });
  });

  // ── GET ──────────────────────────────────────────────────────────────────

  describe('GET /api/claims/:id/comments', () => {
    it('returns empty array when no comments exist', async () => {
      const res = await request(app.getHttpServer()).get(`/api/claims/${claimId}/comments`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns active comments ordered by createdAt asc', async () => {
      const token = mintUserToken(WALLET_A);
      await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'first' });
      await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'second' });

      const res = await request(app.getHttpServer()).get(`/api/claims/${claimId}/comments`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].body).toBe('first');
      expect(res.body[1].body).toBe('second');
    });

    it('excludes soft-deleted comments', async () => {
      const token = mintUserToken(WALLET_A);
      const postRes = await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'to be deleted' });
      const commentId: string = postRes.body.id;

      await request(app.getHttpServer())
        .delete(`/api/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${token}`);

      const listRes = await request(app.getHttpServer()).get(`/api/claims/${claimId}/comments`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(0);
    });

    it('returns 404 for unknown claim', async () => {
      const res = await request(app.getHttpServer()).get('/api/claims/999888777/comments');
      expect(res.status).toBe(404);
    });
  });

  // ── POST ─────────────────────────────────────────────────────────────────

  describe('POST /api/claims/:id/comments', () => {
    it('creates a comment and returns 201 with correct shape', async () => {
      const token = mintUserToken(WALLET_A);
      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'hello world' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        claimId,
        authorAddress: WALLET_A,
        body: expect.any(String),
        createdAt: expect.any(String),
      });
    });

    it('returns 401 without a token', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .send({ body: 'no auth' });
      expect(res.status).toBe(401);
    });

    it('returns 400 for empty body', async () => {
      const token = mintUserToken(WALLET_A);
      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for body exceeding 2000 chars', async () => {
      const token = mintUserToken(WALLET_A);
      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'x'.repeat(2001) });
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown claim', async () => {
      const token = mintUserToken(WALLET_A);
      const res = await request(app.getHttpServer())
        .post('/api/claims/999888777/comments')
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'test' });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE ───────────────────────────────────────────────────────────────

  describe('DELETE /api/claims/:id/comments/:commentId', () => {
    async function createComment(wallet: string): Promise<string> {
      const token = mintUserToken(wallet);
      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'a comment' });
      return res.body.id as string;
    }

    it('author can delete their own comment (204)', async () => {
      const commentId = await createComment(WALLET_A);
      const token = mintUserToken(WALLET_A);
      const res = await request(app.getHttpServer())
        .delete(`/api/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);
    });

    it('admin can delete any comment (204)', async () => {
      const commentId = await createComment(WALLET_A);
      const adminToken = mintAdminToken(WALLET_B);
      const res = await request(app.getHttpServer())
        .delete(`/api/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });

    it('non-author non-admin gets 403', async () => {
      const commentId = await createComment(WALLET_A);
      const otherToken = mintUserToken(WALLET_B);
      const res = await request(app.getHttpServer())
        .delete(`/api/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it('deleted comment is excluded from subsequent list', async () => {
      const commentId = await createComment(WALLET_A);
      const token = mintUserToken(WALLET_A);
      await request(app.getHttpServer())
        .delete(`/api/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${token}`);

      const listRes = await request(app.getHttpServer()).get(`/api/claims/${claimId}/comments`);
      expect(listRes.body.find((c: { id: string }) => c.id === commentId)).toBeUndefined();
    });

    it('returns 401 without token', async () => {
      const commentId = await createComment(WALLET_A);
      const res = await request(app.getHttpServer()).delete(
        `/api/claims/${claimId}/comments/${commentId}`,
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent comment', async () => {
      const token = mintUserToken(WALLET_A);
      const res = await request(app.getHttpServer())
        .delete(`/api/claims/${claimId}/comments/nonexistent-id`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Admin comment moderation ─────────────────────────────────────────────

  describe('DELETE /api/admin/claims/:id/comments/:commentId', () => {
    async function createComment(wallet: string): Promise<string> {
      const token = mintUserToken(wallet);
      const res = await request(app.getHttpServer())
        .post(`/api/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'moderation test comment' });
      return res.body.id as string;
    }

    it('admin can soft-delete any comment (204)', async () => {
      const commentId = await createComment(WALLET_A);
      const adminToken = mintAdminToken(WALLET_B);
      const res = await request(app.getHttpServer())
        .delete(`/api/admin/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'spam' });
      expect(res.status).toBe(204);
    });

    it('deleted comment is excluded from regular user GET', async () => {
      const commentId = await createComment(WALLET_A);
      const adminToken = mintAdminToken(WALLET_B);
      await request(app.getHttpServer())
        .delete(`/api/admin/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const listRes = await request(app.getHttpServer()).get(
        `/api/claims/${claimId}/comments`,
      );
      expect(listRes.body.find((c: { id: string }) => c.id === commentId)).toBeUndefined();
    });

    it('admin view includes deleted comments', async () => {
      const commentId = await createComment(WALLET_A);
      const adminToken = mintAdminToken(WALLET_B);
      await request(app.getHttpServer())
        .delete(`/api/admin/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const adminListRes = await request(app.getHttpServer())
        .get(`/api/admin/claims/${claimId}/comments`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminListRes.status).toBe(200);
      const found = adminListRes.body.find((c: { id: string }) => c.id === commentId);
      expect(found).toBeDefined();
      expect(found.deletedAt).not.toBeNull();
    });

    it('non-admin gets 403', async () => {
      const commentId = await createComment(WALLET_A);
      const userToken = mintUserToken(WALLET_B);
      const res = await request(app.getHttpServer())
        .delete(`/api/admin/claims/${claimId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });

    it('returns 401 without token', async () => {
      const commentId = await createComment(WALLET_A);
      const res = await request(app.getHttpServer()).delete(
        `/api/admin/claims/${claimId}/comments/${commentId}`,
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent comment', async () => {
      const adminToken = mintAdminToken(WALLET_B);
      const res = await request(app.getHttpServer())
        .delete(`/api/admin/claims/${claimId}/comments/nonexistent-id`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Rate limit ───────────────────────────────────────────────────────────

  describe('Rate limiting on POST /api/claims/:id/comments', () => {
    it('returns 429 after exceeding per-wallet-per-claim limit', async () => {
      const token = mintUserToken(WALLET_A);
      const limit = 3; // WALLET_RATE_LIMIT_DEFAULTS.LIMIT
      let lastStatus = 0;

      for (let i = 0; i <= limit; i++) {
        const res = await request(app.getHttpServer())
          .post(`/api/claims/${claimId}/comments`)
          .set('Authorization', `Bearer ${token}`)
          .send({ body: `comment ${i}` });
        lastStatus = res.status;
        if (res.status === 429) break;
      }

      expect(lastStatus).toBe(429);
    });
  });
});
