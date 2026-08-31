import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { FeedsService } from './feeds.service';

/** True when the caller's Accept header explicitly asks for JSON. */
function prefersJson(acceptHeader?: string): boolean {
  if (!acceptHeader) return false;
  return acceptHeader
    .split(',')
    .map((type) => type.split(';')[0].trim().toLowerCase())
    .includes('application/json');
}

/**
 * Public feed endpoints — no auth required.
 * Excluded from Swagger: these are machine-readable feeds, not API endpoints.
 */
@ApiExcludeController()
@Controller('feeds')
export class FeedsController {
  constructor(private readonly feedsService: FeedsService) {}

  /**
   * GET /feeds/claims.atom
   *
   * Atom 1.0 feed of the 50 most recently finalized claims (approved or rejected).
   * Useful for community monitoring tools and transparency dashboards.
   *
   * Content negotiation: `Accept: application/json` returns the same items as
   * structured JSON. Any other Accept header (including rss+xml/atom+xml, none,
   * or unrecognized values) falls back to the Atom XML default, unchanged.
   *
   * Cache-Control is set to 5 minutes — finalization is an infrequent event.
   */
  @Get('claims.atom')
  async claimsAtom(@Headers('accept') accept: string | undefined, @Res() res: Response): Promise<void> {
    res.set('Cache-Control', 'public, max-age=300');

    if (prefersJson(accept)) {
      const items = await this.feedsService.buildClaimsJsonFeed();
      res.set('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(items));
      return;
    }

    const xml = await this.feedsService.getCachedClaimsAtomFeed();
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.end(xml);
  }
}
