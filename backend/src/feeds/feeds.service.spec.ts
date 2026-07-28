import { FeedsService } from './feeds.service';

const makePrisma = (claims = [] as object[]) => ({
  claim: {
    findMany: jest.fn().mockResolvedValue(claims),
  },
});

const makeConfig = (baseUrl = 'https://example.com') => ({
  get: jest.fn().mockReturnValue(baseUrl),
});

const sampleClaims = [
  {
    id: 42,
    policyId: 'GABC:1',
    creatorAddress: 'GABC123',
    amount: '1000',
    asset: 'USDC',
    description: 'Flood damage',
    status: 'APPROVED',
    updatedAt: new Date('2026-06-01T12:00:00Z'),
  },
  {
    id: 43,
    policyId: 'GXYZ:2',
    creatorAddress: 'GXYZ456',
    amount: '500',
    asset: null,
    description: null,
    status: 'REJECTED',
    updatedAt: new Date('2026-05-30T08:00:00Z'),
  },
];

describe('FeedsService', () => {
  it('returns valid Atom XML with correct Content-Type hint', async () => {
    const service = new FeedsService(makePrisma(sampleClaims) as never, makeConfig() as never);
    const xml = await service.buildClaimsAtomFeed();
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('</feed>');
  });

  it('includes one <entry> per finalized claim', async () => {
    const service = new FeedsService(makePrisma(sampleClaims) as never, makeConfig() as never);
    const xml = await service.buildClaimsAtomFeed();
    const entryCount = (xml.match(/<entry>/g) ?? []).length;
    expect(entryCount).toBe(2);
  });

  it('renders claim id, status, and amount in entry title', async () => {
    const service = new FeedsService(makePrisma(sampleClaims) as never, makeConfig() as never);
    const xml = await service.buildClaimsAtomFeed();
    expect(xml).toContain('Claim #42');
    expect(xml).toContain('APPROVED');
    expect(xml).toContain('1000');
    expect(xml).toContain('USDC');
  });

  it('defaults asset to XLM when null', async () => {
    const service = new FeedsService(makePrisma(sampleClaims) as never, makeConfig() as never);
    const xml = await service.buildClaimsAtomFeed();
    expect(xml).toContain('XLM');
  });

  it('queries only finalized, non-deleted claims limited to 50', async () => {
    const prisma = makePrisma([]);
    const service = new FeedsService(prisma as never, makeConfig() as never);
    await service.buildClaimsAtomFeed();
    expect(prisma.claim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isFinalized: true, deletedAt: null },
        take: 50,
        orderBy: { updatedAt: 'desc' },
      }),
    );
  });

  it('escapes XML special characters in description', async () => {
    const claimWithSpecialChars = [{
      ...sampleClaims[0],
      description: 'Fire & <storm> "damage"',
    }];
    const service = new FeedsService(makePrisma(claimWithSpecialChars) as never, makeConfig() as never);
    const xml = await service.buildClaimsAtomFeed();
    expect(xml).toContain('Fire &amp; &lt;storm&gt; &quot;damage&quot;');
  });

  it('returns empty feed when no claims', async () => {
    const service = new FeedsService(makePrisma([]) as never, makeConfig() as never);
    const xml = await service.buildClaimsAtomFeed();
    expect(xml).toContain('<feed');
    expect(xml).not.toContain('<entry>');
  });
});

describe('FeedsService — JSON feed', () => {
  it('returns the same claims as structured JSON items', async () => {
    const service = new FeedsService(makePrisma(sampleClaims) as never, makeConfig() as never);
    const items = await service.buildClaimsJsonFeed();

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 42,
      policyId: 'GABC:1',
      creatorAddress: 'GABC123',
      amount: '1000',
      asset: 'USDC',
      status: 'approved',
    });
    expect(items[0].title).toContain('Claim #42');
    expect(items[0].url).toBe('https://example.com/claims/42');
  });

  it('defaults asset to XLM when null', async () => {
    const service = new FeedsService(makePrisma(sampleClaims) as never, makeConfig() as never);
    const items = await service.buildClaimsJsonFeed();
    expect(items[1].asset).toBe('XLM');
  });

  it('does not XML-escape text content', async () => {
    const claimWithSpecialChars = [{
      ...sampleClaims[0],
      description: 'Fire & <storm> "damage"',
    }];
    const service = new FeedsService(makePrisma(claimWithSpecialChars) as never, makeConfig() as never);
    const items = await service.buildClaimsJsonFeed();
    expect(items[0].summary).toBe('Fire & <storm> "damage"');
  });

  it('returns an empty array when there are no finalized claims', async () => {
    const service = new FeedsService(makePrisma([]) as never, makeConfig() as never);
    const items = await service.buildClaimsJsonFeed();
    expect(items).toEqual([]);
  });

  it('queries the same finalized/non-deleted/limit-50 criteria as the Atom feed', async () => {
    const prisma = makePrisma([]);
    const service = new FeedsService(prisma as never, makeConfig() as never);
    await service.buildClaimsJsonFeed();
    expect(prisma.claim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isFinalized: true, deletedAt: null },
        take: 50,
        orderBy: { updatedAt: 'desc' },
      }),
    );
  });
});
