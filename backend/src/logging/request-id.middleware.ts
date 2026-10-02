import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { requestContextStorage } from './request-context.store';

@Injectable()
export class LoggingRequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    const walletAddress =
      (req.headers['x-wallet-address'] as string | undefined) ?? undefined;

    requestContextStorage.run({ requestId, walletAddress }, next);
  }
}
