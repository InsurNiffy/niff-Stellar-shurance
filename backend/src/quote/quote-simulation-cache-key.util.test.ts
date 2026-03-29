import {
  buildNormalizedQuoteCanonicalJson,
  buildQuoteSimulationCacheKeyHash,
} from './quote-simulation-cache-key.util';
import {
  CoverageTierEnum,
  PolicyTypeEnum,
  RegionTierEnum,
} from './dto/generate-premium.dto';

describe('quote-simulation-cache-key.util', () => {
  it('sorts keys for stable canonical JSON', () => {
    const a = buildNormalizedQuoteCanonicalJson({
      policy_type: PolicyTypeEnum.Auto,
      region: RegionTierEnum.Medium,
      coverage_tier: CoverageTierEnum.Standard,
      age: 40,
      risk_score: 3,
      source_account:
        'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I',
    });
    expect(a).toBe(
      '{"age":40,"coverage_tier":"Standard","policy_type":"Auto","region":"Medium","risk_score":3,"source_account":"GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I"}',
    );
  });

  it('same logical inputs produce same hash', () => {
    const dto = {
      policy_type: PolicyTypeEnum.Property,
      region: RegionTierEnum.High,
      coverage_tier: CoverageTierEnum.Premium,
      age: 22,
      risk_score: 8,
      source_account: 'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I',
    };
    const h1 = buildQuoteSimulationCacheKeyHash(dto, 'C1', 'net-a');
    const h2 = buildQuoteSimulationCacheKeyHash(dto, 'C1', 'net-a');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('different contract id changes hash', () => {
    const dto = {
      policy_type: PolicyTypeEnum.Health,
      region: RegionTierEnum.Low,
      coverage_tier: CoverageTierEnum.Basic,
      age: 50,
      risk_score: 2,
      source_account: '',
    };
    const h1 = buildQuoteSimulationCacheKeyHash(dto, 'CAAA', 'net');
    const h2 = buildQuoteSimulationCacheKeyHash(dto, 'CBBB', 'net');
    expect(h1).not.toBe(h2);
  });
});
