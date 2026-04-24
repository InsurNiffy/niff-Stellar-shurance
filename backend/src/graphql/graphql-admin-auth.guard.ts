import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthIdentityService } from '../auth/auth-identity.service';
import type { GraphqlContext } from './graphql.context';

@Injectable()
export class GraphqlAdminAuthGuard implements CanActivate {
  constructor(private readonly authIdentity: AuthIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlContext = GqlExecutionContext.create(context).getContext<GraphqlContext>();
    const identity = await this.authIdentity.resolveRequestIdentity(gqlContext.req);

    if (!identity) {
      throw new UnauthorizedException('Authentication is required');
    }

    if (identity.kind !== 'staff' || identity.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }

    return true;
  }
}
