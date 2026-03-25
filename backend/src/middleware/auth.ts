import { Request, Response, NextFunction } from 'express';
import jwtService from '../services/jwt';
import config from '../config';
import { AuthenticatedRequest } from '../types';

/**
 * Authentication middleware
 * Verifies JWT token from Authorization header
 * Expected format: Bearer <token>
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const authHeader = authReq.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header is required',
      statusCode: 401,
    });
    return;
  }

  const parts = authHeader.split(' ');
  
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authorization header format. Use: Bearer <token>',
      statusCode: 401,
    });
    return;
  }

  const token = parts[1];

  try {
    const payload = jwtService.verifyAccessToken(token);
    
    authReq.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (error) {
    // Log auth failure without leaking sensitive information
    if (config.logging.logAuthFailures) {
      console.error(`[AUTH] Token verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (error instanceof Error) {
      if (error.name === 'TokenExpiredError') {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Token has expired',
          statusCode: 401,
        });
        return;
      }

      if (error.name === 'JsonWebTokenError') {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid token',
          statusCode: 401,
        });
        return;
      }
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed',
      statusCode: 401,
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but allows request to proceed even without auth
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const authHeader = authReq.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  const parts = authHeader.split(' ');
  
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    next();
    return;
  }

  const token = parts[1];

  try {
    const payload = jwtService.verifyAccessToken(token);
    
    authReq.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    // Ignore invalid tokens for optional auth
  }

  next();
}

export default authenticate;