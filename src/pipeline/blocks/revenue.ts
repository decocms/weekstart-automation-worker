/**
 * Revenue block — Block 3 of the WeekStart scorecard.
 *
 * Exclusion rules: status "unknown" and "canceled" are excluded before every metric.
 */

import type { CollectRecord } from "../../core/types";
import { getYearMonth, previousMonth, lastDayOfMonth } from "../../core/date";

export type RevenueMonthMetrics = {
  billedAmount: number;
  receivedAmount: number;
  /** Unpaid receivables (registered/overdue) due on or before the last day of this month. */
  expectedInflow: number;
};

export type RevenueBlock = {
  referenceMonth: string; // "YYYY-MM"
  current: RevenueMonthMetrics;
  previous: RevenueMonthMetrics;
  /** Snapshot of all open receivables across ALL months (not a period metric). */
  totalOpen: number;
  /** QuickChart URL for the cumulative Cash In chart, assembled in the calculate stage. */
  chartUrl: string;
};

export type RevenueBlockConfig = {
  timezone: string;   // IANA timezone
  referenceMonth: string; // "YYYY-MM"
};

function computeMonthMetrics(
  records: CollectRecord[],
  month: string,
  timezone: string,
): RevenueMonthMetrics {
  let billedAmount = 0;
  let receivedAmount = 0;
  let expectedInflow = 0;

  const monthEnd = lastDayOfMonth(month);

  for (const r of records) {
    if (r.status === "unknown" || r.status === "canceled") continue;

    const amount = r.amount ?? 0;

    if (getYearMonth(r.invoiceCreatedAt, timezone) === month) billedAmount += amount;

    if (getYearMonth(r.paidDate, timezone) === month) receivedAmount += amount;

    // Uses dueDate (post-renegotiation), not originalDueDate. String comparison works for "YYYY-MM-DD".
    if (
      (r.status === "registered" || r.status === "overdue") &&
      r.dueDate !== null &&
      r.dueDate <= monthEnd
    ) {
      expectedInflow += amount;
    }
  }

  return { billedAmount, receivedAmount, expectedInflow };
}

function computeTotalOpen(records: CollectRecord[]): number {
  return records
    .filter(r => r.status === "registered" || r.status === "overdue")
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);
}

/**
 * Daily Cash In (received) data for both months, used to build the cumulative
 * Cash In chart. chartUrl is assembled in the calculate stage.
 *
 * Pure — no I/O.
 */
export type RevenueDailyData = {
  currDailyReceived:   Map<number, number>; // day → daily received (paidDate, date-only)
  prevDailyReceived:   Map<number, number>;
  daysInMonth:         number;              // current month total calendar days
  daysInPrevMonth:     number;              // previous month total calendar days
  daysElapsedReceived: number;              // max day with paidDate data in current month
};

/**
 * Aggregates daily received amounts from Airtable records for both months.
 *
 * - Received: keyed by paidDate (YYYY-MM-DD → direct slice, no tz needed)
 *
 * Pure — no I/O.
 */
export function computeDailyRevenue(
  records: CollectRecord[],
  referenceMonth: string,
  prevMonth: string,
  timezone: string,
): RevenueDailyData {
  const currDailyReceived = new Map<number, number>();
  const prevDailyReceived = new Map<number, number>();

  for (const r of records) {
    if (r.status === "unknown" || r.status === "canceled") continue;
    if (r.amount === null) continue;
    const amount = r.amount;

    // Received: paidDate is YYYY-MM-DD — timezone-independent, direct slice
    if (r.paidDate !== null) {
      const paidMonth = r.paidDate.slice(0, 7);
      const paidDay   = Number(r.paidDate.slice(8, 10));
      if (paidMonth === referenceMonth) {
        currDailyReceived.set(paidDay, (currDailyReceived.get(paidDay) ?? 0) + amount);
      } else if (paidMonth === prevMonth) {
        prevDailyReceived.set(paidDay, (prevDailyReceived.get(paidDay) ?? 0) + amount);
      }
    }
  }

  const daysInMonth     = Number(lastDayOfMonth(referenceMonth).slice(8, 10));
  const daysInPrevMonth = Number(lastDayOfMonth(prevMonth).slice(8, 10));

  // Use current day of month (in timezone) instead of last day with payment data.
  // This ensures the chart shows progress up to today even if no payments occurred today.
  const now = new Date();
  const currentYearMonth = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" })
    .format(now)
    .slice(0, 7); // "YYYY-MM"
  const currentDayOfMonth = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, day: "2-digit" }).format(now)
  );

  // Only use current day if we're in the reference month; otherwise use full month
  const daysElapsedReceived = currentYearMonth === referenceMonth
    ? Math.min(currentDayOfMonth, daysInMonth)
    : daysInMonth;

  return {
    currDailyReceived, prevDailyReceived,
    daysInMonth, daysInPrevMonth,
    daysElapsedReceived,
  };
}

/**
 * Builds a cumulative series array for a chart dataset.
 * Returns null for every day after daysElapsed (no data yet / month ended).
 * Returns all-null if the daily map is empty (no data for that month).
 */
function cumulativeSeries(
  dailyMap: Map<number, number>,
  daysInMonth: number,
  daysElapsed: number,
): (number | null)[] {
  if (dailyMap.size === 0) return Array.from({ length: daysInMonth }, () => null);
  let running = 0;
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    if (day > daysElapsed) return null;
    running += dailyMap.get(day) ?? 0;
    return Math.round(running);
  });
}

/**
 * Builds the Chart.js config for the cumulative Cash In chart.
 *
 * Two datasets — instantly readable at a glance:
 *   - Gray line:  previous month cumulative Cash In (baseline / reference)
 *   - Green line: current month  cumulative Cash In (current progress)
 *
 * Cumulative lines never decrease, making progress clear even with sporadic
 * payment events (some days R$0, some days R$200k+).
 *
 * Pure — no I/O.
 */
export function buildRevenueChartConfig(data: RevenueDailyData): object {
  const {
    currDailyReceived, prevDailyReceived,
    daysInMonth, daysInPrevMonth,
    daysElapsedReceived,
  } = data;

  const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));

  const prevReceived = cumulativeSeries(prevDailyReceived, daysInMonth, daysInPrevMonth);
  const currReceived = cumulativeSeries(currDailyReceived, daysInMonth, daysElapsedReceived);

  return {
    type: "line",
    data: {
      labels,
      datasets: [
        // Previous month: gray (baseline reference)
        { label: "Mês anterior", data: prevReceived, borderColor: "#aaaaaa", borderWidth: 1, pointRadius: 0, fill: false, spanGaps: false },
        // Current month: green (current progress)
        { label: "Mês atual", data: currReceived, borderColor: "#4cb782", borderWidth: 2, pointRadius: 0, fill: false, spanGaps: false },
      ],
    },
    options: {
      legend: { display: true, position: "bottom", labels: { boxWidth: 12, fontSize: 10 } },
      scales: { yAxes: [{ ticks: { beginAtZero: true } }] },
    },
  };
}

export function runRevenueBlock(
  records: CollectRecord[],
  config: RevenueBlockConfig,
): Omit<RevenueBlock, "chartUrl"> {
  const { referenceMonth, timezone } = config;
  const prevMonth = previousMonth(referenceMonth);

  return {
    referenceMonth,
    current:   computeMonthMetrics(records, referenceMonth, timezone),
    previous:  computeMonthMetrics(records, prevMonth, timezone),
    totalOpen: computeTotalOpen(records),
  };
}
