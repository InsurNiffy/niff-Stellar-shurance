import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import type { Response } from 'express';

function makeResponse() {
  const headers: Record<string, string> = {};
  const res = {
    set: jest.fn((key: string, value: string) => {
      headers[key] = value;
      return res;
    }),
    end: jest.fn(),
  } as unknown as Response;
  return { res, headers };
}

describe('FeedsController — content negotiation', () => {
  let feedsService: jest.Mocked<Pick<FeedsService, 'getCachedClaimsAtomFeed' | 'buildClaimsJsonFeed'>>;
  let controller: FeedsController;

  beforeEach(() => {
    feedsService = {
      getCachedClaimsAtomFeed: jest.fn().mockResolvedValue('<feed>xml</feed>'),
      buildClaimsJsonFeed: jest.fn().mockResolvedValue([{ id: 1, title: 'Claim #1' }]),
    };
    controller = new FeedsController(feedsService as unknown as FeedsService);
  });

  it('returns JSON when Accept: application/json is sent', async () => {
    const { res, headers } = makeResponse();

    await controller.claimsAtom('application/json', res);

    expect(feedsService.buildClaimsJsonFeed).toHaveBeenCalled();
    expect(feedsService.getCachedClaimsAtomFeed).not.toHaveBeenCalled();
    expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(res.end).toHaveBeenCalledWith(JSON.stringify([{ id: 1, title: 'Claim #1' }]));
  });

  it('returns Atom XML unchanged when Accept: application/rss+xml is sent', async () => {
    const { res, headers } = makeResponse();

    await controller.claimsAtom('application/rss+xml', res);

    expect(feedsService.getCachedClaimsAtomFeed).toHaveBeenCalled();
    expect(feedsService.buildClaimsJsonFeed).not.toHaveBeenCalled();
    expect(headers['Content-Type']).toBe('application/atom+xml; charset=utf-8');
    expect(res.end).toHaveBeenCalledWith('<feed>xml</feed>');
  });

  it('returns Atom XML by default when no Accept header is sent', async () => {
    const { res, headers } = makeResponse();

    await controller.claimsAtom(undefined, res);

    expect(feedsService.getCachedClaimsAtomFeed).toHaveBeenCalled();
    expect(headers['Content-Type']).toBe('application/atom+xml; charset=utf-8');
  });

  it('falls back to Atom XML for an unrecognized Accept header', async () => {
    const { res, headers } = makeResponse();

    await controller.claimsAtom('text/html', res);

    expect(feedsService.getCachedClaimsAtomFeed).toHaveBeenCalled();
    expect(headers['Content-Type']).toBe('application/atom+xml; charset=utf-8');
  });

  it('sets a 5-minute cache-control header regardless of format', async () => {
    const { res: jsonRes, headers: jsonHeaders } = makeResponse();
    await controller.claimsAtom('application/json', jsonRes);
    expect(jsonHeaders['Cache-Control']).toBe('public, max-age=300');

    const { res: xmlRes, headers: xmlHeaders } = makeResponse();
    await controller.claimsAtom(undefined, xmlRes);
    expect(xmlHeaders['Cache-Control']).toBe('public, max-age=300');
  });
});
