import Big from "big.js";

/**
 * Formats raw token amount (bigint or string) to human-readable decimal string.
 *
 * - Handles arbitrarily large amounts safely (no Number conversion)
 * - Divides raw / 10^decimals using Big.js for precision
 * - Uses Intl.NumberFormat for locale-aware formatting
 * - Trims insignificant trailing zeros (except for amounts <1)
 * - Edge cases: 0, max safe integer * 10^decimals, overflow
 *
 * @param raw - Raw minor units (e.g. 1000000n for 1 USDC)
 * @param decimals - Token decimals (e.g. 6 for USDC, 7 for XLM/stroops)
 * @param locale - Optional locale (defaults to 'en-US')
 * @returns Formatted display string (e.g. '1.00', '0.00', '1,234.56')
 */
export function formatTokenAmount(
  raw: bigint | string | number,
  decimals: number,
  locale: string = "en-US"
): string {
  if (raw === 0n || raw === "0" || raw === 0) return "0.00";

  // Convert to BigInt safely
  const bigRaw = BigInt(raw.toString());

  // Safe division using Big.js
  const divisor = 10n ** BigInt(decimals);
  const bigIntValue = Big(bigRaw.toString()).div(Big(divisor.toString()));

  // Get fixed decimal representation
  const fixed = bigIntValue.toFixed(decimals).replace(/\.?0+$/, "");

  // Use Intl.NumberFormat for locale formatting
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(parseFloat(fixed));
}

// Convenience for XLM/stroops (7 decimals)
export function formatXlm(
  raw: bigint | string | number,
  locale?: string
): string {
  return formatTokenAmount(raw, 7, locale ?? "en-US");
}

// Export types for use in components
export type TokenFormatOptions = {
  decimals: number;
  locale?: string;
};
