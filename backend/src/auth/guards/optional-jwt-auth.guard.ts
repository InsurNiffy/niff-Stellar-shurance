import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but never blocks the request: an absent or invalid
 * token simply leaves `request.user` unset instead of throwing. Used on
 * public read endpoints that grant extra visibility to authenticated
 * callers (e.g. previewing a scheduled post) without requiring auth.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = { walletAddress: string }>(
    _err: Error | null,
    user: TUser | false,
  ): TUser | undefined {
    return user || undefined;
  }
}
