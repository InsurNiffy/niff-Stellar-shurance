import { formatDecimalNumber, formatFixed2 } from '../format-number'

describe('formatDecimalNumber', () => {
  it('formats using en-US separators', () => {
    expect(formatDecimalNumber(1234.5, 'en-US')).toBe('1,234.5')
  })

  it('formats using de-DE separators', () => {
    expect(formatDecimalNumber(1234.5, 'de-DE')).toBe('1.234,5')
  })

  it('caps fraction digits at 2 by default', () => {
    expect(formatDecimalNumber(1.239, 'en-US')).toBe('1.24')
  })
})

describe('formatFixed2', () => {
  it('always shows 2 decimal places in en-US', () => {
    expect(formatFixed2(5, 'en-US')).toBe('5.00')
  })

  it('always shows 2 decimal places in de-DE', () => {
    expect(formatFixed2(5, 'de-DE')).toBe('5,00')
  })
})
