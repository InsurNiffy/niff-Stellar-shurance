import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Staff role hierarchy (lowest → highest privilege):
 *   viewer < admin < superadmin
 *
 * `support_readonly` is kept as a backwards-compatible alias for `viewer` so
 * existing JWTs issued before this migration continue to work.
 */
export type StaffRole = 'superadmin' | 'admin' | 'viewer' | 'support_readonly';

/** Ordered list used by the guard to compare minimum-required role. */
export const STAFF_ROLE_RANK: Record<StaffRole, number> = {
  viewer: 0,
  support_readonly: 0, // alias for viewer
  admin: 1,
  superadmin: 2,
};

export type AuthIdentity =
  | { kind: 'wallet'; walletAddress: string }
  | { kind: 'staff'; staffId: string; email: string; role: StaffRole; scopes: string[] };

type RequestWithIdentity = Request & {
  authIdentity?: AuthIdentity | null;
};

@Injectable()
export class AuthIdentityService {
  constructor(private readonly config: ConfigService) {}

  async resolveRequestIdentity(req: Request): Promise<AuthIdentity | null> {
    const request = req as RequestWithIdentity;
    if (request.authIdentity !== undefined) {
      return request.authIdentity;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      request.authIdentity = null;
      return null;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      request.authIdentity = null;
      return null;
    }

    try {
      const payload = jwt.verify(token, this.config.get<string>('JWT_SECRET') ?? '') as Record<
        string,
        unknown
      >;
      const identity = this.toIdentity(payload);
      request.authIdentity = identity;
      return identity;
    } catch {
      request.authIdentity = null;
      return null;
    }
  }

  private toIdentity(payload: Record<string, unknown>): AuthIdentity | null {
    if (typeof payload.walletAddress === 'string' && payload.walletAddress.length > 0) {
      return { kind: 'wallet', walletAddress: payload.walletAddress };
    }

    const validRoles: StaffRole[] = ['superadmin', 'admin', 'viewer', 'support_readonly'];
    if (
      typeof payload.sub === 'string' &&
      typeof payload.email === 'string' &&
      validRoles.includes(payload.role as StaffRole)
    ) {
      const rawScopes = Array.isArray(payload.scopes)
        ? payload.scopes
        : typeof payload.scope === 'string'
          ? payload.scope.split(' ')
          : [];
      return {
        kind: 'staff',
        staffId: payload.sub,
        email: payload.email,
        role: payload.role as StaffRole,
        scopes: rawScopes.filter((scope): scope is string => typeof scope === 'string'),
      };
    }

    return null;
  }
}
