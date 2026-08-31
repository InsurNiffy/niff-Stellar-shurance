import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthIdentityService, STAFF_ROLE_RANK, StaffRole } from '../../auth/auth-identity.service';
import { ADMIN_ROLE_KEY } from '../decorators/admin.decorator';

/**
 * Role hierarchy guard for all /admin routes.
 *
 * Tiers (lowest → highest privilege):
 *   viewer (0) < admin (1) < superadmin (2)
 *
 * Annotate handlers with @MinAdminRole('viewer') to allow read-only staff on
 * GET endpoints, or @MinAdminRole('superadmin') for privileged operations.
 * Unannotated handlers default to requiring 'admin' or above.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  private readonly logger = new Logger(AdminRoleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authIdentity: AuthIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());
    if (isPublic) {
      return true;
    }

    const request = this.getRequest(context);
    const ip = request.ip || request.connection?.remoteAddress;

    const minRole: StaffRole =
      this.reflector.getAllAndOverride<StaffRole>(ADMIN_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'admin';

    try {
      const identity = await this.authIdentity.resolveRequestIdentity(request);

      if (!identity) {
        this.logger.warn(`Unauthenticated admin access attempt from IP: ${ip}`);
        throw new ForbiddenException('Authentication required for admin access');
      }

      if (identity.kind !== 'staff') {
        this.logger.warn(`Non-staff user attempted admin access: ${identity.kind} from IP: ${ip}`);
        throw new ForbiddenException('Staff role required for admin access');
      }

      const callerRank = STAFF_ROLE_RANK[identity.role] ?? -1;
      const requiredRank = STAFF_ROLE_RANK[minRole] ?? 0;

      if (callerRank < requiredRank) {
        this.logger.warn(
          `Insufficient admin role: caller=${identity.role} required=${minRole} IP=${ip}`,
        );
        throw new ForbiddenException(
          `Insufficient permissions: requires '${minRole}' or higher`,
        );
      }

      (request as Request & { adminIdentity: typeof identity }).adminIdentity = identity;
      this.logger.debug(
        `Admin access granted to ${identity.staffId} (role=${identity.role}) from IP: ${ip}`,
      );
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Admin auth guard error: ${msg}`, stack);
      throw new ForbiddenException('Admin authentication failed');
    }
  }

  private getRequest(context: ExecutionContext): Request {
    if (context.getType() === 'http') {
      return context.switchToHttp().getRequest<Request>();
    }
    const gqlContext = context.getArgByIndex(2) as { req?: Request } | Request | undefined;
    return ((gqlContext as { req?: Request })?.req ?? gqlContext) as Request;
  }
}
