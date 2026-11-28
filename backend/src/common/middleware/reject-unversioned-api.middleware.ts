import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Rejects API requests that do not target a versioned URI (e.g. `/v1/...`).
 * Non-API routes (health checks, docs, static assets) are left untouched.
 */
@Injectable()
export class RejectUnversionedApiMiddleware implements NestMiddleware {
  private static readonly VERSIONED_API = /^\/v\d+(\/|$)/;
  private static readonly API_PREFIX = /^\/api(\/|$)/;

  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.originalUrl.split('?')[0];

    if (RejectUnversionedApiMiddleware.VERSIONED_API.test(path)) {
      next();
      return;
    }

    if (RejectUnversionedApiMiddleware.API_PREFIX.test(path)) {
      res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message:
          'API version is required. Use a versioned URI such as /v1/...',
      });
      return;
    }

    next();
  }
}
