import { FeedsModule } from './feeds.module';
import { FeedsService } from './feeds.service';

const makePrisma = (claims = [] as object[]) => ({
  claim: {
    findMany: jest.fn().mockResolvedValue(claims),
  },
});

const makeConfig = (baseUrl = 'https://example.com') => ({
  get: jest.fn().mockReturnValue(baseUrl),
});

describe('FeedsModule onModuleInit', () => {
  it('populates the feed cache immediately after module init', async () => {
    const service = new FeedsService(makePrisma() as never, makeConfig() as never);
    const module = new FeedsModule(service);

    const cachedBefore = (service as unknown as { claimsAtomFeedCache: string | null }).claimsAtomFeedCache;
    expect(cachedBefore).toBeNull();

    await module.onModuleInit();

    const xml = await service.getCachedClaimsAtomFeed();
    expect(xml).toContain('<feed');
  });

  it('logs but does not throw when feed generation fails at boot', async () => {
    const failingPrisma = {
      claim: { findMany: jest.fn().mockRejectedValue(new Error('db unavailable')) },
    };
    const service = new FeedsService(failingPrisma as never, makeConfig() as never);
    const module = new FeedsModule(service);

    await expect(module.onModuleInit()).resolves.toBeUndefined();
  });
});
