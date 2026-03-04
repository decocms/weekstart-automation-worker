/**
 * Shared date utilities for pipeline stages and blocks.
 *
 * All functions work with "YYYY-MM" month strings, which is the canonical
 * date granularity used throughout this codebase. Individual day values
 * are used only when computing range boundaries (e.g. last day of a month).
 */

/**
 * Converts a Date object to a "YYYY-MM" string in the given IANA timezone.
 *
 * Used when source data stores timestamps as UTC (e.g. Airtable datetime
 * fields come back as "2026-03-01T11:47:00.000Z") and we need to attribute
 * the record to the correct local calendar month.
 */
export function toYearMonth(d: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}

/**
 * Returns the "YYYY-MM" of the month immediately before the given month.
 * Correctly wraps January of any year to December of the previous year.
 *
 * @example previousMonth("2026-01") === "2025-12"
 * @example previousMonth("2026-03") === "2026-02"
 */
export function previousMonth(ym: string): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * Returns the last calendar day of the given month as a "YYYY-MM-DD" string.
 *
 * Uses the "day 0 of the following month" trick: passing day=0 to the UTC
 * constructor rolls back to the last day of the previous month, avoiding any
 * manual leap-year or days-per-month arithmetic.
 *
 * @example lastDayOfMonth("2026-03") === "2026-03-31"
 * @example lastDayOfMonth("2024-02") === "2024-02-29"  // leap year
 */
export function lastDayOfMonth(ym: string): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  // JS Date months are 0-indexed: passing `month` (1-indexed) as the month
  // argument is equivalent to month+1 in 0-indexed, so day=0 rolls back to
  // the last day of the 1-indexed `month`.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Extracts "YYYY-MM" from a date string, handling two formats:
 *
 * - Date-only ("2026-03-17"): the month is read directly without any
 *   timezone conversion, since date-only fields represent a calendar day
 *   independent of time zone.
 *
 * - ISO datetime ("2026-03-17T14:00:00.000Z"): parsed and converted to the
 *   given timezone before extracting the month, so that records near month
 *   boundaries are attributed to the correct local month.
 *
 * Returns null for empty or unparseable strings.
 */
export function getYearMonth(dateStr: string | null, timezone: string): string | null {
  if (!dateStr?.trim()) return null;
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : toYearMonth(d, timezone);
}
