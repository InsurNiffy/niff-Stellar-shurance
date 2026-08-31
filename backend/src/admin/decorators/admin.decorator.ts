import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import type { StaffRole } from '../../auth/auth-identity.service';

export const ADMIN_ROLE_KEY = 'minAdminRole';

/**
 * Set the minimum staff role required to call this endpoint.
 * Tiers (lowest → highest): viewer < admin < superadmin
 *
 * @example
 *   @MinAdminRole('viewer')   // read-only staff can access
 *   @MinAdminRole('admin')    // default — ops/admin staff only
 *   @MinAdminRole('superadmin') // highest-privilege operations
 */
export const MinAdminRole = (role: StaffRole) =>
  applyDecorators(SetMetadata(ADMIN_ROLE_KEY, role));

/**
 * Marks an endpoint as requiring admin guard (explicit).
 * The minimum role defaults to 'admin' unless overridden by @MinAdminRole.
 */
export const Admin = () => UseGuards(AdminRoleGuard);

/**
 * Marks public admin endpoints (bypass auth entirely).
 * Used for health checks or status endpoints reachable without a token.
 */
export const PublicAdmin = () => SetMetadata('isPublic', true);
