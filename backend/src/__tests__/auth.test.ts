import request from 'supertest';
import jwtService from '../services/jwt';
import { authenticate } from '../middleware/auth';
import { requireRole, requireAdmin, requireSupportReadonly } from '../middleware/role';
import express, { Response } from 'express';

// Create a test app
const testApp = express();
testApp.use(express.json());

// Test routes with different auth levels
testApp.get('/public', (_req, res: Response) => res.json({ message: 'public' }));
testApp.get('/protected', authenticate, (_req, res: Response) => res.json({ message: 'protected' }));
testApp.get('/admin-only', authenticate, requireAdmin, (_req, res: Response) => res.json({ message: 'admin-only' }));
testApp.get('/support-only', authenticate, requireSupportReadonly, (_req, res: Response) => res.json({ message: 'support-only' }));
testApp.get('/role-test', authenticate, requireRole('admin'), (_req, res: Response) => res.json({ message: 'role-test' }));

describe('Authentication Middleware', () => {
  describe('401 - Unauthenticated Access', () => {
    it('should return 401 when no authorization header is present', async () => {
      const response = await request(testApp).get('/protected');
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 401 when authorization header is malformed', async () => {
      const response = await request(testApp)
        .get('/protected')
        .set('Authorization', 'InvalidFormat');
      expect(response.status).toBe(401);
    });

    it('should return 401 when token is invalid', async () => {
      const response = await request(testApp)
        .get('/protected')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(response.status).toBe(401);
    });
  });

  describe('200 - Authenticated Access', () => {
    it('should allow access with valid token', async () => {
      const token = jwtService.generateAccessToken({
        id: 'test-id',
        email: 'test@example.com',
        role: 'admin',
      });

      const response = await request(testApp)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
    });

    it('should allow access to public endpoints without token', async () => {
      const response = await request(testApp).get('/public');
      expect(response.status).toBe(200);
    });
  });
});

describe('Role-Based Access Control', () => {
  const adminToken = jwtService.generateAccessToken({
    id: 'admin-id',
    email: 'admin@example.com',
    role: 'admin',
  });

  const supportToken = jwtService.generateAccessToken({
    id: 'support-id',
    email: 'support@example.com',
    role: 'support_readonly',
  });

  describe('403 - Insufficient Permissions', () => {
    it('should return 403 for support_readonly accessing admin-only route', async () => {
      const response = await request(testApp)
        .get('/admin-only')
        .set('Authorization', `Bearer ${supportToken}`);
      expect(response.status).toBe(403);
    });

    it('should return 403 when required role is not met', async () => {
      const userToken = jwtService.generateAccessToken({
        id: 'user-id',
        email: 'user@example.com',
        role: 'support_readonly',
      });

      const response = await request(testApp)
        .get('/role-test')
        .set('Authorization', `Bearer ${userToken}`);
      expect(response.status).toBe(403);
    });
  });

  describe('200 - Authorized Access', () => {
    it('should allow admin to access admin-only route', async () => {
      const response = await request(testApp)
        .get('/admin-only')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(200);
    });

    it('should allow admin to access support-only route', async () => {
      const response = await request(testApp)
        .get('/support-only')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(200);
    });

    it('should allow support_readonly to access support-only route', async () => {
      const response = await request(testApp)
        .get('/support-only')
        .set('Authorization', `Bearer ${supportToken}`);
      expect(response.status).toBe(200);
    });
  });
});