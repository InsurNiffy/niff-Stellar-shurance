import { Router, Request, Response, NextFunction } from 'express';
import userService from '../services/user';
import jwtService from '../services/jwt';
import config from '../config';
import { LoginRequest, LoginResponse, AuthenticatedRequest } from '../types';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * POST /auth/login
 * Staff login endpoint
 * Body: { email: string, password: string }
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body as LoginRequest;

    // Validate input
    if (!email || !password) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
        statusCode: 400,
      });
      return;
    }

    // Authenticate user
    const user = await userService.authenticate(email, password);

    if (!user) {
      // Log authentication failure without leaking credentials
      if (config.logging.logAuthFailures) {
        console.error(`[AUTH] Login failed for email: ${email}`);
      }

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
        statusCode: 401,
      });
      return;
    }

    // Generate tokens
    const tokens = jwtService.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const response: LoginResponse = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 * Body: { refreshToken: string }
 */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token is required',
        statusCode: 400,
      });
      return;
    }

    const result = await jwtService.refreshAccessToken(refreshToken, (id) => userService.findById(id));

    if (!result) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
        statusCode: 401,
      });
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /auth/me
 * Get current authenticated user info
 * Requires: Bearer token
 */
router.get('/me', authenticate, (req: Request, res: Response): void => {
  const authReq = req as AuthenticatedRequest;
  res.status(200).json(authReq.user);
});

/**
 * POST /auth/logout
 * Logout endpoint (client should discard tokens)
 * Note: For token invalidation, consider implementing a blacklist in production
 */
router.post('/logout', (_req, res: Response): void => {
  // In a production system, you might want to:
  // 1. Add token to a blacklist
  // 2. Clear any server-side sessions
  // For now, we just confirm logout - client must discard tokens
  res.status(200).json({
    message: 'Logged out successfully. Please discard your tokens.',
  });
});

export default router;