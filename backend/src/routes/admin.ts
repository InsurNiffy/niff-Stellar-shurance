import { Router, Response, NextFunction, Request } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole, requireAdmin, requireSupportReadonly, requirePermission } from '../middleware/role';
import { AuthenticatedRequest } from '../types';
import userService from '../services/user';

const router = Router();

// Apply authentication to all admin routes
router.use(authenticate);

/**
 * GET /admin/dashboard
 * Admin dashboard data
 * Required role: admin
 */
router.get('/dashboard', requireAdmin, (req: Request, res: Response): void => {
  const authReq = req as AuthenticatedRequest;
  res.status(200).json({
    message: 'Admin dashboard accessed successfully',
    user: authReq.user,
    data: {
      totalStaff: 2,
      totalPolicies: 0,
      totalClaims: 0,
    },
  });
});

/**
 * GET /admin/users
 * List all staff users
 * Required role: admin
 */
router.get('/users', requireAdmin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await userService.getAllUsers();
    res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/users
 * Create a new staff user
 * Required role: admin
 */
router.post('/users', requireAdmin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Email, password, and role are required',
        statusCode: 400,
      });
      return;
    }

    const user = await userService.createUser(email, password, role);
    
    res.status(201).json({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'User already exists') {
      res.status(409).json({
        error: 'Conflict',
        message: 'User already exists',
        statusCode: 409,
      });
      return;
    }
    next(error);
  }
});

/**
 * DELETE /admin/users/:id
 * Deactivate a staff user
 * Required role: admin
 */
router.delete('/users/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const success = await userService.deactivateUser(id);

    if (!success) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
        statusCode: 404,
      });
      return;
    }

    res.status(200).json({ message: 'User deactivated successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/policies
 * List all policies (admin view)
 * Required role: admin or support_readonly
 */
router.get('/policies', requireSupportReadonly, (_req: Request, res: Response): void => {
  res.status(200).json({
    policies: [],
    message: 'Policy list accessed (admin/support)',
  });
});

/**
 * GET /admin/claims
 * List all claims (admin view)
 * Required role: admin or support_readonly
 */
router.get('/claims', requireSupportReadonly, (_req: Request, res: Response): void => {
  res.status(200).json({
    claims: [],
    message: 'Claims list accessed (admin/support)',
  });
});

/**
 * GET /admin/audit
 * View audit logs
 * Required role: admin or support_readonly
 */
router.get('/audit', requireSupportReadonly, (_req: Request, res: Response): void => {
  res.status(200).json({
    logs: [],
    message: 'Audit logs accessed (admin/support)',
  });
});

/**
 * GET /admin/settings
 * Application settings (admin only)
 * Required role: admin
 */
router.get('/settings', requireAdmin, (_req: Request, res: Response): void => {
  res.status(200).json({
    settings: {
      maintenanceMode: false,
      registrationEnabled: true,
    },
  });
});

/**
 * Example: Permission-based route
 * GET /admin/reports
 * Required permission: admin:audit:read
 */
router.get('/reports', requirePermission('admin:audit:read'), (_req: Request, res: Response): void => {
  res.status(200).json({
    reports: [],
    message: 'Reports accessed with permission check',
  });
});

export default router;