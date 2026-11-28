import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface GraphQLWalletUser {
  sub: string;
  walletAddress: string;
  [key: string]: unknown;
}

@Injectable()
export class GraphQLWalletAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context);
    const request = ctx.getContext<{ req?: Request }>()?.req;

    if (!request) {
      throw new UnauthorizedException('Missing GraphQL request context');
    }

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing Authorization bearer token');
    }

    try {
      const payload = this.jwtService.verify<GraphQLWalletUser>(token);
      if (!payload?.walletAddress) {
        throw new UnauthorizedException('Token is missing wallet address');
      }
      (request as Request & { user?: GraphQLWalletUser }).user = payload;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: Request): string | null {
    const header = request.headers?.authorization;
    if (!header || typeof header !== 'string') {
      return null;
    }
    const [scheme, value] = header.split(' ');
    if (!value || scheme.toLowerCase() !== 'bearer') {
      return null;
    }
    return value.trim() || null;
  }
}
