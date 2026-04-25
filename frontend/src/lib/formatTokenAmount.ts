/**
 * Formats a raw minor-unit token amount to a human-readable decimal string.
 *
 * Uses only native BigInt arithmetic — no floating-point conversion — so
 * amounts up to 2^53-1 minor units (and beyond) are represented exactly.
 *
 * @param raw      - Raw minor units (bigint | string | number)
 * @param decimals - Token decimal places (e.g. 7 for XLM/stroops, 6 for USDC)
 * @param locale   - BCP 47 locale tag for Intl.NumberFormat (default: 'en-US')
 * @returns Locale-formatted string, e.g. '1,234.567890' or '0.00'
 *
 * @example
 * formatTokenAmount(10_000_000n, 7)          // '1.00'        (1 XLM)
 * formatTokenAmount('1000000', 6, 'de-DE')   // '1,00'        (1 USDC, German)
 * formatTokenAmount(0n, 7)                   // '0.00'
 */
export function formatTokenAmount(
  raw: bigint | string | number,
  decimals: number,
  locale = 'en-US',
): string {
  const bigRaw = BigInt(raw.toString())
  const divisor = 10n ** BigInt(decimals)

  const whole = bigRaw / divisor
  const remainder = bigRaw % divisor

  // Zero-pad the fractional part to `decimals` digits
  const fracStr = remainder.toString().padStart(decimals, '0')

  // Build a decimal string and parse it back for Intl formatting
  const decimalStr = decimals > 0 ? `${whole}.${fracStr}` : whole.toString()

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(Number(decimalStr))
}

/** Convenience wrapper for XLM / stroops (7 decimals). */
export function formatXlm(raw: bigint | string | number, locale = 'en-US'): string {
  return formatTokenAmount(raw, 7, locale)
}
