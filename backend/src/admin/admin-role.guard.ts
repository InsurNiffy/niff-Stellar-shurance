import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Guard that restricts access to admin-only endpoints.
 *
 * Reads the authenticated user from the request (populated by the JWT
 * strategy) and verifies the `role` claim is `admin`. Any caller that is
 * unauthenticated or lacks the admin role receives a 403 consistently.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request?.user;

    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }

    return true;
  }
}
