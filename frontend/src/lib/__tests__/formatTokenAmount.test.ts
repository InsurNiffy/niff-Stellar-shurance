import { formatTokenAmount, formatXlm } from '../formatTokenAmount'

describe('formatTokenAmount', () => {
  it('formats zero as 0.00', () => {
    expect(formatTokenAmount(0n, 7)).toBe('0.00')
    expect(formatTokenAmount('0', 7)).toBe('0.00')
    expect(formatTokenAmount(0, 7)).toBe('0.00')
  })

  it('formats 1 XLM (10_000_000 stroops)', () => {
    expect(formatTokenAmount(10_000_000n, 7)).toBe('1.00')
  })

  it('formats 1 USDC (1_000_000 minor units, 6 decimals)', () => {
    expect(formatTokenAmount(1_000_000n, 6)).toBe('1.00')
  })

  it('formats large amounts correctly', () => {
    // 1,000 XLM = 10_000_000_000 stroops
    expect(formatTokenAmount(10_000_000_000n, 7)).toBe('1,000.00')
  })

  it('formats max safe integer worth of stroops without precision loss', () => {
    // Number.MAX_SAFE_INTEGER stroops = 900,719,925.4740991 XLM
    const raw = BigInt(Number.MAX_SAFE_INTEGER)
    const result = formatTokenAmount(raw, 7)
    expect(result).toMatch(/^900,719,925/)
  })

  it('formats sub-unit amounts (less than 1 token)', () => {
    expect(formatTokenAmount(1n, 7)).toBe('0.00')
    expect(formatTokenAmount(500_000n, 7)).toBe('0.05')
  })

  it('accepts string and number inputs', () => {
    expect(formatTokenAmount('10000000', 7)).toBe('1.00')
    expect(formatTokenAmount(10000000, 7)).toBe('1.00')
  })

  it('changes display format for locale without changing the amount', () => {
    const raw = 1_234_560_000n // 123.456 XLM
    const en = formatTokenAmount(raw, 7, 'en-US')
    const de = formatTokenAmount(raw, 7, 'de-DE')
    // Both represent the same value but with different separators
    expect(en).toContain('123')
    expect(de).toContain('123')
    // German uses comma as decimal separator
    expect(de).not.toBe(en)
  })

  it('formats with 0 decimals', () => {
    expect(formatTokenAmount(42n, 0)).toBe('42.00')
  })
})

describe('formatXlm', () => {
  it('is a convenience wrapper for 7 decimals', () => {
    expect(formatXlm(10_000_000n)).toBe('1.00')
    expect(formatXlm(10_000_000n, 'en-US')).toBe(formatTokenAmount(10_000_000n, 7, 'en-US'))
  })
})
