/**
 * GeoBlockGuard — optional jurisdiction block on policy initiation.
 *
 * Reads the CF-IPCountry header (Cloudflare) or X-Country-Code header
 * (fallback, e.g. for non-Cloudflare deployments) and rejects requests
 * from countries listed in the BLOCKED_COUNTRIES env var with 451
 * (Unavailable For Legal Reasons).
 *
 * Fails open: a missing geo header allows the request (no false positives).
 * Configurable without code changes via BLOCKED_COUNTRIES (comma-separated
 * ISO 3166-1 alpha-2 codes).
 */

import { Injectable, CanActivate, ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class GeoBlockGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const countryCode =
      (request.headers['cf-ipcountry'] as string | undefined) ??
      (request.headers['x-country-code'] as string | undefined);

    if (!countryCode) return true;

    const blocked = (this.configService.get<string>('BLOCKED_COUNTRIES') ?? '')
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);

    if (blocked.includes(countryCode.trim().toUpperCase())) {
      throw new HttpException(
        {
          statusCode: 451,
          error: 'Unavailable For Legal Reasons',
          message: `Policy initiation is not available in your region (${countryCode.trim().toUpperCase()}).`,
        },
        451,
      );
    }

    return true;
  }
}
