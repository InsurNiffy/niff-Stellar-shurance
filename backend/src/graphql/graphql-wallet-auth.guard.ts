import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthIdentityService } from '../auth/auth-identity.service';
import type { GraphqlContext } from './graphql.context';

@Injectable()
export class GraphqlWalletAuthGuard implements CanActivate {
  constructor(private readonly authIdentity: AuthIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlContext = GqlExecutionContext.create(context).getContext<GraphqlContext>();
    const identity = await this.authIdentity.resolveRequestIdentity(gqlContext.req);

    if (!identity || identity.kind !== 'wallet') {
      throw new UnauthorizedException('Wallet authentication is required');
    }

    return true;
  }
}
