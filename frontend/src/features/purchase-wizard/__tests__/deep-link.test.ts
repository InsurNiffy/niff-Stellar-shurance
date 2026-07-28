import { parseDeepLinkCoverage } from '../deep-link'

describe('parseDeepLinkCoverage', () => {
  it('parses a valid shared quote link into coverage details', () => {
    const params = new URLSearchParams({
      policy_type: 'Health',
      region: 'High',
      coverage_tier: 'Premium',
      age: '45',
      risk_score: '7',
      source_account: 'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I',
      premium_xlm: '2.5',
      premium_stroops: '25000000',
    })

    expect(parseDeepLinkCoverage(params)).toEqual({
      policy_type: 'Health',
      region: 'High',
      coverage_tier: 'Premium',
      age: 45,
      risk_score: 7,
      source_account: 'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I',
    })
  })

  it('returns null when required params are missing', () => {
    const params = new URLSearchParams({ policy_type: 'Health', region: 'High' })
    expect(parseDeepLinkCoverage(params)).toBeNull()
  })

  it('returns null for an invalid enum value', () => {
    const params = new URLSearchParams({
      policy_type: 'NotARealType',
      region: 'High',
      coverage_tier: 'Premium',
      age: '45',
      risk_score: '7',
    })
    expect(parseDeepLinkCoverage(params)).toBeNull()
  })

  it('returns null for an out-of-range age', () => {
    const params = new URLSearchParams({
      policy_type: 'Health',
      region: 'High',
      coverage_tier: 'Premium',
      age: '200',
      risk_score: '7',
    })
    expect(parseDeepLinkCoverage(params)).toBeNull()
  })

  it('returns null for a malformed source_account', () => {
    const params = new URLSearchParams({
      policy_type: 'Health',
      region: 'High',
      coverage_tier: 'Premium',
      age: '45',
      risk_score: '7',
      source_account: 'not-a-valid-key',
    })
    expect(parseDeepLinkCoverage(params)).toBeNull()
  })

  it('ignores unrelated extra params (e.g. premium_xlm) and still validates', () => {
    const params = new URLSearchParams({
      policy_type: 'Auto',
      region: 'Low',
      coverage_tier: 'Basic',
      age: '30',
      risk_score: '5',
    })
    expect(parseDeepLinkCoverage(params)).not.toBeNull()
  })
})
