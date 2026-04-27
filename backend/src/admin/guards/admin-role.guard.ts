import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthIdentityService } from '../../auth/auth-identity.service';

/**
 * Enhanced admin role guard that verifies the caller has staff-level privileges.
 * Supports both HTTP and GraphQL contexts and provides detailed logging.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  private readonly logger = new Logger(AdminRoleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authIdentity: AuthIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if public endpoint (bypass auth)
    const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());
    if (isPublic) {
      return true;
    }

    const request = this.getRequest(context);
    const ip = request.ip || request.connection?.remoteAddress;
    
    try {
      // Resolve identity using the auth service
      const identity = await this.authIdentity.resolveRequestIdentity(request);
      
      if (!identity) {
        this.logger.warn(`Unauthenticated admin access attempt from IP: ${ip}`);
        throw new ForbiddenException('Authentication required for admin access');
      }

      // Verify staff role and admin privileges
      if (identity.kind !== 'staff') {
        this.logger.warn(`Non-staff user attempted admin access: ${identity.kind} from IP: ${ip}`);
        throw new ForbiddenException('Staff role required for admin access');
      }

      if (identity.role !== 'admin') {
        this.logger.warn(`Non-admin staff attempted admin access: ${identity.role} from IP: ${ip}`);
        throw new ForbiddenException('Admin role required');
      }

      // Attach identity to request for downstream use
      request.adminIdentity = identity;
      
      this.logger.debug(`Admin access granted to ${identity.walletAddress} from IP: ${ip}`);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      
      this.logger.error(`Admin auth guard error: ${error.message}`, error.stack);
      throw new ForbiddenException('Admin authentication failed');
    }
  }

  private getRequest(context: ExecutionContext): any {
    if (context.getType() === 'http') {
      return context.switchToHttp().getRequest();
    }
    
    // GraphQL context
    const gqlContext = context.getArgByIndex(2);
    return gqlContext?.req || gqlContext;
  }
}
