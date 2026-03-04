/**
 * Revenue block — Block 3 of the WeekStart scorecard.
 *
 * Computes accounts-receivable metrics from normalized CollectRecords.
 * All logic is pure (no I/O, no side effects) and operates over the full
 * record set passed in, filtered and grouped internally.
 *
 * Exclusion rules applied before every metric:
 *   - status "unknown"  → excluded (data quality issue, no financial impact)
 *   - status "canceled" → excluded (already removed by the Airtable view,
 *                          but guarded here for safety)
 */

import type { CollectRecord } from "../../core/types";
import { getYearMonth, previousMonth, lastDayOfMonth } from "../../core/date";

// ---- Types ------------------------------------------------------------------

/** Revenue metrics for a single calendar month. */
export type RevenueMonthMetrics = {
  /** Sum of Valor for records whose invoice was emitted (invoiceCreatedAt) this month. */
  billedAmount: number;
  /** Sum of Valor for records whose payment was confirmed (paidDate) this month. */
  receivedAmount: number;
  /**
   * Cash expected to arrive: all unpaid receivables (registered or overdue)
   * with an originalDueDate on or before the last day of this month.
   * This captures both current-month and past-due open items in a single filter.
   */
  expectedInflow: number;
};

/**
 * Revenue block output covering the reference month, the previous month for
 * comparison, and a point-in-time snapshot of total open receivables.
 */
export type RevenueBlock = {
  referenceMonth: string; // "YYYY-MM"
  current: RevenueMonthMetrics;
  previous: RevenueMonthMetrics;
  /**
   * Sum of Valor for all registered/overdue records across ALL months.
   * This is a snapshot of the current receivables portfolio — not a period metric.
   */
  totalOpen: number;
};

/** Configuration required to run the revenue block. */
export type RevenueBlockConfig = {
  timezone: string;   // IANA timezone (e.g. "America/Sao_Paulo")
  referenceMonth: string; // "YYYY-MM"
};

// ---- Internal helpers -------------------------------------------------------

/**
 * Computes all per-month revenue metrics for the given calendar month.
 * Skips records with status "unknown" or "canceled" before any aggregation.
 */
function computeMonthMetrics(
  records: CollectRecord[],
  month: string,
  timezone: string,
): RevenueMonthMetrics {
  let billedAmount = 0;
  let receivedAmount = 0;
  let expectedInflow = 0;

  // Upper bound for expectedInflow: any unpaid record due on or before this date
  // is considered collectible this month (current-month + past-due, in one filter).
  const monthEnd = lastDayOfMonth(month);

  for (const r of records) {
    if (r.status === "unknown" || r.status === "canceled") continue;

    const amount = r.amount ?? 0;

    // Invoiced: invoice emitted this month (timezone-aware).
    if (getYearMonth(r.invoiceCreatedAt, timezone) === month) billedAmount += amount;

    // Cash in: payment confirmed this month, regardless of when the invoice was issued.
    // Intentionally includes records with a null invoiceCreatedAt.
    if (getYearMonth(r.paidDate, timezone) === month) receivedAmount += amount;

    // Expected inflow: unpaid records (registered or overdue) due on or before
    // the last day of this month. originalDueDate is a date-only string
    // ("YYYY-MM-DD"), so string comparison is correct.
    if (
      (r.status === "registered" || r.status === "overdue") &&
      r.originalDueDate !== null &&
      r.originalDueDate <= monthEnd
    ) {
      expectedInflow += amount;
    }
  }

  return { billedAmount, receivedAmount, expectedInflow };
}

/**
 * Sums Valor for all registered and overdue records across all months.
 * The result is a point-in-time snapshot of the full receivables portfolio.
 * It is always >= expectedInflow because it also includes future-dated open records.
 */
function computeTotalOpen(records: CollectRecord[]): number {
  return records
    .filter(r => r.status === "registered" || r.status === "overdue")
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);
}

// ---- Public API -------------------------------------------------------------

/** Runs the revenue block and returns metrics for the reference and previous months. */
export function runRevenueBlock(
  records: CollectRecord[],
  config: RevenueBlockConfig,
): RevenueBlock {
  const { referenceMonth, timezone } = config;
  const prevMonth = previousMonth(referenceMonth);

  return {
    referenceMonth,
    current:   computeMonthMetrics(records, referenceMonth, timezone),
    previous:  computeMonthMetrics(records, prevMonth, timezone),
    totalOpen: computeTotalOpen(records),
  };
}
