import { Request } from 'express';

/**
 * Role types for staff authentication
 */
export type StaffRole = 'admin' | 'support_readonly';

/**
 * JWT Payload structure
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: StaffRole;
  iat: number;
  exp: number;
}

/**
 * Staff user entity
 */
export interface StaffUser {
  id: string;
  email: string;
  passwordHash: string;
  role: StaffRole;
  createdAt: Date;
  lastLoginAt?: Date;
  isActive: boolean;
}

/**
 * Login request body
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Login response
 */
export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    role: StaffRole;
  };
}

/**
 * Refresh token response
 */
export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

/**
 * Authenticated request with user
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: StaffRole;
  };
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

/**
 * Role permissions mapping
 */
export const ROLE_PERMISSIONS: Record<StaffRole, string[]> = {
  admin: [
    'admin:dashboard',
    'admin:users:read',
    'admin:users:write',
    'admin:users:delete',
    'admin:policies:read',
    'admin:policies:write',
    'admin:claims:read',
    'admin:claims:write',
    'admin:audit:read',
  ],
  support_readonly: [
    'support:users:read',
    'support:policies:read',
    'support:claims:read',
    'support:audit:read',
  ],
};