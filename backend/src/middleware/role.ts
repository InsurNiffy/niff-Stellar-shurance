import { Response, NextFunction, Request } from 'express';
import { StaffRole, ROLE_PERMISSIONS, AuthenticatedRequest } from '../types';

export type RequiredRoles = StaffRole | StaffRole[];
export type Permission = string;
export type RequiredPermissions = Permission | Permission[];

/**
 * Role-based authorization middleware factory
 * @param requiredRoles - Single role or array of roles that are allowed to access
 */
export function requireRole(...requiredRoles: StaffRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
      return;
    }

    const userRole = authReq.user.role;

    if (!requiredRoles.includes(userRole)) {
      // Log authorization failure (no sensitive data)
      console.error(`[AUTH] Role check failed: user ${authReq.user.email} with role ${userRole} attempted to access ${req.method} ${req.path} requiring ${requiredRoles.join(' or ')}`);

      res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. Required role: ${requiredRoles.join(' or ')}. Your role: ${userRole}`,
        statusCode: 403,
      });
      return;
    }

    next();
  };
}

/**
 * Permission-based authorization middleware factory
 * @param requiredPermissions - Single permission or array of permissions required
 */
export function requirePermission(...requiredPermissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
      return;
    }

    const userPermissions = ROLE_PERMISSIONS[authReq.user.role] || [];
    
    const hasPermission = requiredPermissions.every(perm => userPermissions.includes(perm));

    if (!hasPermission) {
      // Log authorization failure (no sensitive data)
      console.error(`[AUTH] Permission check failed: user ${authReq.user.email} with role ${authReq.user.role} lacks required permissions: ${requiredPermissions.join(', ')}`);

      res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. Required permissions: ${requiredPermissions.join(', ')}`,
        statusCode: 403,
      });
      return;
    }

    next();
  };
}

/**
 * Admin-only middleware (shortcut for requireRole('admin'))
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireRole('admin')(req, res, next);
}

/**
 * Support read-only middleware (shortcut for requireRole('support_readonly'))
 */
export function requireSupportReadonly(req: Request, res: Response, next: NextFunction): void {
  requireRole('support_readonly', 'admin')(req, res, next);
}

export default requireRole;