/**
 * Shared, locale-aware number formatting utility built on Intl.NumberFormat.
 *
 * Use this instead of ad-hoc `toLocaleString()` / `toFixed()` call sites so
 * every page formats plain decimal numbers the same way.
 */
export function formatDecimalNumber(
  value: number,
  locale = 'en-US',
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  }).format(value)
}

/** Convenience wrapper matching the common "2 decimal places" display case. */
export function formatFixed2(value: number, locale = 'en-US'): string {
  return formatDecimalNumber(value, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
