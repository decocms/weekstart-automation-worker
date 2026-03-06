/**
 * Costs block — Block 4 of the WeekStart scorecard.
 *
 * Tracks GCP infrastructure costs with same-period month-over-month comparisons.
 * Data source: ClickHouse fact_gcp_cost_daily table.
 *
 * I/O is isolated in collectCostsData. runCostsBlock is pure (no I/O).
 *
 * Edge case: When the previous month has no data for the same period (e.g. data
 * starts mid-month), samePeriodDiffPct will be null to avoid division by zero.
 */

import { previousMonth } from "../../core/date";

// ---- Types ------------------------------------------------------------------

export type CostsMonthMetrics = {
  totalCost: number;
  daysElapsed: number;
};

export type CostsServiceBreakdown = {
  service: string;
  currentMtd: number;
  previousSamePeriod: number;
  diffPct: number | null; // null when previousSamePeriod is 0
};

export type CostsBlock = {
  referenceMonth: string;           // "YYYY-MM"
  daysElapsed: number;              // days elapsed in current month with data
  daysInMonth: number;              // total calendar days in current month
  current: CostsMonthMetrics;       // first N days of current month
  previous: CostsMonthMetrics;      // first N days of previous month (same period)
  previousMonthTotal: number;       // full previous month total (for context)
  projectedEOM: number;             // weighted projection to end of month
  samePeriodDiffPct: number | null; // % change vs same period (null when previous is 0)
  topServices: CostsServiceBreakdown[];
  chartUrl: string;                 // QuickChart.io image URL for Linear
};

export type CostsBlockConfig = {
  referenceMonth: string; // "YYYY-MM"
};

// ---- Raw data types from ClickHouse -----------------------------------------

type RawSummaryRow = {
  days_elapsed: number;
  days_in_month: number;
  current_mtd: number;
  previous_same_period: number;
  previous_full_month: number;
  same_period_diff_pct: number | null; // null when previous_same_period = 0
};

type RawServiceRow = {
  service: string;
  current_mtd: number;
  previous_same_period: number;
  diff_pct: number | null; // null when previous_same_period = 0
};

type RawDailyRow = {
  date: string;       // "YYYY-MM-DD"
  daily_cost: number;
};

export type CostsRawData = {
  summary: RawSummaryRow;
  services: RawServiceRow[];
  daily: RawDailyRow[];
};

export type CostsCollectConfig = {
  statsLakeUrl: string;
  statsLakeUser: string;
  statsLakePassword: string;
};

// ---- ClickHouse queries -----------------------------------------------------

/**
 * Query A: Same-period comparison.
 * CASE WHEN handles division-by-zero directly in SQL, returning NULL.
 */
const QUERY_SUMMARY = `
WITH
  days_elapsed AS (
    SELECT toDayOfMonth(max(date)) AS n
    FROM fact_gcp_cost_daily
    WHERE toStartOfMonth(date) = toStartOfMonth(today())
  ),
  current_mtd AS (
    SELECT sum(cost) AS total
    FROM fact_gcp_cost_daily
    WHERE toStartOfMonth(date) = toStartOfMonth(today())
  ),
  previous_same_period AS (
    SELECT sum(cost) AS total
    FROM fact_gcp_cost_daily
    WHERE toStartOfMonth(date) = toStartOfMonth(today()) - INTERVAL 1 MONTH
      AND toDayOfMonth(date) <= (SELECT n FROM days_elapsed)
  ),
  previous_full_month AS (
    SELECT sum(cost) AS total
    FROM fact_gcp_cost_daily
    WHERE toStartOfMonth(date) = toStartOfMonth(today()) - INTERVAL 1 MONTH
  )
SELECT
  (SELECT n FROM days_elapsed)            AS days_elapsed,
  toDayOfMonth(toLastDayOfMonth(today())) AS days_in_month,
  current_mtd.total                       AS current_mtd,
  previous_same_period.total              AS previous_same_period,
  previous_full_month.total               AS previous_full_month,
  CASE
    WHEN previous_same_period.total = 0 THEN NULL
    ELSE round(
      (current_mtd.total - previous_same_period.total)
      / previous_same_period.total * 100, 2
    )
  END AS same_period_diff_pct
FROM current_mtd, previous_same_period, previous_full_month
FORMAT JSONEachRow
`.trim();

/**
 * Query B: Service breakdown with same-period comparison.
 */
const QUERY_SERVICES = `
WITH
  days_elapsed AS (
    SELECT toDayOfMonth(max(date)) AS n
    FROM fact_gcp_cost_daily
    WHERE toStartOfMonth(date) = toStartOfMonth(today())
  ),
  current_month AS (
    SELECT service_description, sum(cost) AS cost_mtd
    FROM fact_gcp_cost_daily
    WHERE toStartOfMonth(date) = toStartOfMonth(today())
    GROUP BY service_description
  ),
  previous_same_period AS (
    SELECT service_description, sum(cost) AS cost_prev
    FROM fact_gcp_cost_daily
    WHERE toStartOfMonth(date) = toStartOfMonth(today()) - INTERVAL 1 MONTH
      AND toDayOfMonth(date) <= (SELECT n FROM days_elapsed)
    GROUP BY service_description
  )
SELECT
  coalesce(c.service_description, p.service_description) AS service,
  coalesce(c.cost_mtd, 0)  AS current_mtd,
  coalesce(p.cost_prev, 0) AS previous_same_period,
  CASE
    WHEN coalesce(p.cost_prev, 0) = 0 THEN NULL
    ELSE round(
      (coalesce(c.cost_mtd, 0) - coalesce(p.cost_prev, 0))
      / coalesce(p.cost_prev, 0.001) * 100, 2
    )
  END AS diff_pct
FROM current_month c
FULL OUTER JOIN previous_same_period p
  ON c.service_description = p.service_description
WHERE coalesce(c.cost_mtd, 0) > 0 OR coalesce(p.cost_prev, 0) > 0
ORDER BY current_mtd DESC
LIMIT 10
FORMAT JSONEachRow
`.trim();

/**
 * Query C: Daily costs for both months (for chart and weighted projection).
 */
const QUERY_DAILY = `
SELECT
  date,
  sum(cost) AS daily_cost
FROM fact_gcp_cost_daily
WHERE date >= toStartOfMonth(today()) - INTERVAL 1 MONTH
GROUP BY date
ORDER BY date ASC
FORMAT JSONEachRow
`.trim();

// ---- ClickHouse HTTP client -------------------------------------------------

async function executeQuery(config: CostsCollectConfig, sql: string): Promise<unknown[]> {
  const response = await fetch(config.statsLakeUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.statsLakeUser}:${config.statsLakePassword}`)}`,
    },
    body: sql,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ClickHouse query failed: ${response.status} ${body.slice(0, 240).trim()}`);
  }

  const text = await response.text();
  return text
    .trim()
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return null;
}

function parseSummary(rows: unknown[]): RawSummaryRow {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("ClickHouse summary query returned no rows");
  }
  const r = rows[0] as Record<string, unknown>;
  return {
    days_elapsed:         asFiniteNumber(r.days_elapsed)         ?? 0,
    days_in_month:        asFiniteNumber(r.days_in_month)        ?? 31,
    current_mtd:          asFiniteNumber(r.current_mtd)          ?? 0,
    previous_same_period: asFiniteNumber(r.previous_same_period) ?? 0,
    previous_full_month:  asFiniteNumber(r.previous_full_month)  ?? 0,
    same_period_diff_pct: asFiniteNumber(r.same_period_diff_pct),
  };
}

function parseServices(rows: unknown[]): RawServiceRow[] {
  if (!Array.isArray(rows)) throw new Error("ClickHouse services query returned invalid response");
  return rows.map(row => {
    const r = row as Record<string, unknown>;
    return {
      service:              String(r.service ?? "Unknown"),
      current_mtd:          asFiniteNumber(r.current_mtd)          ?? 0,
      previous_same_period: asFiniteNumber(r.previous_same_period) ?? 0,
      diff_pct:             asFiniteNumber(r.diff_pct),
    };
  });
}

function parseDaily(rows: unknown[]): RawDailyRow[] {
  if (!Array.isArray(rows)) throw new Error("ClickHouse daily query returned invalid response");
  return rows.map(row => {
    const r = row as Record<string, unknown>;
    return {
      date:       String(r.date ?? ""),
      daily_cost: asFiniteNumber(r.daily_cost) ?? 0,
    };
  });
}

/** Fetches all cost data from ClickHouse. Contains all I/O for this block. */
export async function collectCostsData(config: CostsCollectConfig): Promise<CostsRawData> {
  const [summaryRows, serviceRows, dailyRows] = await Promise.all([
    executeQuery(config, QUERY_SUMMARY),
    executeQuery(config, QUERY_SERVICES),
    executeQuery(config, QUERY_DAILY),
  ]);

  return {
    summary:  parseSummary(summaryRows),
    services: parseServices(serviceRows),
    daily:    parseDaily(dailyRows),
  };
}

// ---- Projection -------------------------------------------------------------

/**
 * Weighted projection to end of month.
 *
 * Uses the average of the last min(7, daysElapsed) days as the daily rate.
 * This is more responsive to recent cost trends than the simple MTD / days
 * linear average. Falls back to the MTD average when fewer than 3 days of
 * data are available (insufficient signal for a meaningful window).
 */
function computeProjectedEOM(
  currDailyMap: Map<number, number>,
  daysElapsed: number,
  daysInMonth: number,
  currentMtd: number,
): number {
  if (daysElapsed === 0) return 0;

  const windowSize = Math.min(7, daysElapsed);
  const recentCosts: number[] = [];
  for (let d = daysElapsed; d > daysElapsed - windowSize; d--) {
    const cost = currDailyMap.get(d);
    if (cost !== undefined) recentCosts.push(cost);
  }

  const dailyRate =
    recentCosts.length >= 3
      ? recentCosts.reduce((a, b) => a + b, 0) / recentCosts.length
      : currentMtd / daysElapsed;

  return Math.round((currentMtd + dailyRate * (daysInMonth - daysElapsed)) * 100) / 100;
}

// ---- Chart ------------------------------------------------------------------

/**
 * Builds the Chart.js config object for the two-month cost trend.
 *
 * Three datasets:
 *   - Previous month (grey, full available data)
 *   - Current month actual (green solid, days elapsed only)
 *   - Projection (green dashed, connects from last real day to EOM)
 *
 * Pure — no I/O.
 */
export function buildChartConfig(
  daily: RawDailyRow[],
  block: Omit<CostsBlock, "chartUrl">,
  prevMonth: string,
): object {
  const { referenceMonth, daysElapsed, daysInMonth, projectedEOM, current } = block;

  const prevDailyMap = new Map<number, number>();
  const currDailyMap = new Map<number, number>();
  for (const row of daily) {
    const day   = Number(row.date.slice(8, 10));
    const month = row.date.slice(0, 7);
    if (month === referenceMonth) currDailyMap.set(day, row.daily_cost);
    else if (month === prevMonth) prevDailyMap.set(day, row.daily_cost);
  }

  const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));

  const prevData: (number | null)[] = labels.map((_, i) => {
    const v = prevDailyMap.get(i + 1);
    return v !== undefined ? Math.round(v) : null;
  });

  const currActual: (number | null)[] = labels.map((_, i) => {
    if (i >= daysElapsed) return null;
    const v = currDailyMap.get(i + 1);
    return v !== undefined ? Math.round(v) : null;
  });

  const remainingDays = daysInMonth - daysElapsed;
  const dailyRate     = remainingDays > 0 ? (projectedEOM - current.totalCost) / remainingDays : 0;
  const lastActual    = currDailyMap.get(daysElapsed) ?? dailyRate;

  const currProjection: (number | null)[] = labels.map((_, i) => {
    if (i < daysElapsed - 1) return null;
    if (i === daysElapsed - 1) return Math.round(lastActual);
    return Math.round(dailyRate);
  });

  return {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Mês anterior",
          data: prevData,
          borderColor: "#aaaaaa",
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          spanGaps: false,
        },
        {
          label: "Mês atual",
          data: currActual,
          borderColor: "#4cb782",
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          spanGaps: false,
        },
        {
          label: "Projeção",
          data: currProjection,
          borderColor: "#4cb782",
          borderWidth: 1,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          spanGaps: false,
        },
      ],
    },
    options: {
      legend: { display: true, position: "bottom", labels: { boxWidth: 12, fontSize: 10 } },
      scales: { yAxes: [{ ticks: { beginAtZero: true } }] },
    },
  };
}

/**
 * Builds a QuickChart GET URL from the chart config.
 *
 * Values in the config should already be integers (see buildChartConfig) to
 * keep the URL short. For a 31-day month with 3 datasets this produces a URL
 * well under 1 KB — safe for Linear image embeds and browser loading.
 *
 * Pure — no I/O.
 */
export function buildChartUrl(chartConfig: object): string {
  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encoded}&w=600&h=300&bkg=white`;
}

// ---- Block ------------------------------------------------------------------

/**
 * Pure calculation — no I/O. Receives pre-fetched data, returns metrics.
 * chartUrl is intentionally omitted: it requires an async call to QuickChart
 * and is assembled in the calculate stage after this function returns.
 */
export function runCostsBlock(
  rawData: CostsRawData,
  config: CostsBlockConfig,
): Omit<CostsBlock, "chartUrl"> {
  const { summary, services, daily } = rawData;

  const currDailyMap = new Map<number, number>();
  for (const row of daily) {
    if (row.date.slice(0, 7) === config.referenceMonth) {
      currDailyMap.set(Number(row.date.slice(8, 10)), row.daily_cost);
    }
  }

  const projectedEOM = computeProjectedEOM(
    currDailyMap,
    summary.days_elapsed,
    summary.days_in_month,
    summary.current_mtd,
  );

  const topServices: CostsServiceBreakdown[] = services.map(s => ({
    service:            s.service,
    currentMtd:         s.current_mtd,
    previousSamePeriod: s.previous_same_period,
    diffPct:            s.diff_pct,
  }));

  return {
    referenceMonth:     config.referenceMonth,
    daysElapsed:        summary.days_elapsed,
    daysInMonth:        summary.days_in_month,
    current:            { totalCost: summary.current_mtd,          daysElapsed: summary.days_elapsed },
    previous:           { totalCost: summary.previous_same_period, daysElapsed: summary.days_elapsed },
    previousMonthTotal: summary.previous_full_month,
    projectedEOM,
    samePeriodDiffPct:  summary.same_period_diff_pct,
    topServices,
  };
}
