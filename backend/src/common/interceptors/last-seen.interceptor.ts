import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

type RequestWithUser = {
  user?: { walletAddress?: string };
};

/**
 * Fires-and-forgets a lastSeenAt update for any authenticated wallet request.
 * Non-blocking: errors are swallowed so they never surface to the caller.
 */
@Injectable()
export class LastSeenInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const walletAddress = req.user?.walletAddress;

    if (walletAddress) {
      const now = new Date();
      this.prisma.holderProfile
        .upsert({
          where: { walletAddress },
          create: { walletAddress, lastSeenAt: now },
          update: { lastSeenAt: now },
        })
        .catch(() => undefined);
    }

    return next.handle().pipe(tap(() => undefined));
  }
}
