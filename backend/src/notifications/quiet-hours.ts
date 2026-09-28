/**
 * Quiet-hours window helpers (#1483).
 *
 * Windows are expressed as `HH:mm` and may wrap past midnight
 * (e.g. 22:00 → 07:00). Times are evaluated against the minute-of-day of
 * `now` shifted by `offsetMinutes` (0 = UTC).
 */

export interface QuietHoursWindow {
  start: string;
  end: string;
}

/** Parses `HH:mm` into minutes-of-day. Returns null when malformed. */
export function parseHhMm(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteOfDay(now: Date, offsetMinutes: number): number {
  const utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  return ((utc + offsetMinutes) % 1440 + 1440) % 1440;
}

/**
 * True when `now` falls inside the quiet window (start inclusive, end
 * exclusive). Supports windows that wrap past midnight.
 */
export function isWithinQuietHours(
  now: Date,
  window: QuietHoursWindow,
  offsetMinutes = 0,
): boolean {
  const start = parseHhMm(window.start);
  const end = parseHhMm(window.end);
  if (start === null || end === null || start === end) return false;

  const current = minuteOfDay(now, offsetMinutes);
  if (start < end) return current >= start && current < end;
  // Wraps midnight: quiet from start → 23:59 and 00:00 → end
  return current >= start || current < end;
}

/**
 * Next moment the quiet window ends — i.e. the earliest time delivery is
 * allowed again. Only meaningful when `isWithinQuietHours` is true; returns
 * `now` otherwise.
 */
export function nextQuietPeriodEnd(
  now: Date,
  window: QuietHoursWindow,
  offsetMinutes = 0,
): Date {
  if (!isWithinQuietHours(now, window, offsetMinutes)) return new Date(now.getTime());

  const start = parseHhMm(window.start);
  const end = parseHhMm(window.end);
  if (start === null || end === null) return new Date(now.getTime());

  const current = minuteOfDay(now, offsetMinutes);
  // Minutes until the end of the window (always "forward" in time).
  const minutesUntilEnd = (end - current + 1440) % 1440;
  return new Date(now.getTime() + minutesUntilEnd * 60_000);
}
