import { SetMetadata, UseGuards } from '@nestjs/common';
import { AdminRoleGuard } from '../guards/admin-role.guard';

/**
 * Decorator to mark endpoints as admin-only.
 * Applies the AdminRoleGuard and sets metadata for admin endpoints.
 */
export const Admin = () => UseGuards(AdminRoleGuard);

/**
 * Decorator to mark public admin endpoints (bypass auth).
 * Used for health checks or status endpoints that don't require authentication.
 */
export const PublicAdmin = () => SetMetadata('isPublic', true);
