/**
 * Revenue block - Block 3 of the WeekStart scorecard.
 *
 * Methodological rules:
 * - Revenue and Cash In ignore unknown/canceled statuses.
 * - Ignore null/invalid/non-positive amounts.
 * - Expected inflow counts invoices already issued in NFE.io, still unpaid,
 *   and not canceled.
 * - A/R balance considers only invoiced receivables that remain unsettled up
 *   to the target month.
 */

import type { CollectRecord, ReceivableStatus } from "../../core/types";
import { getYearMonth, previousMonth, lastDayOfMonth } from "../../core/date";

export type RevenueMonthMetrics = {
  billedAmount: number;
  receivedAmount: number;
};

export type RevenueBlock = {
  referenceMonth: string; // "YYYY-MM"
  current: RevenueMonthMetrics;
  previous: RevenueMonthMetrics;
  /** Issued invoices still awaiting payment in the current dataset. */
  expectedInflow: number;
  /** Accounts receivable balance at reference month. */
  totalOpen: number;
  /** QuickChart URL for the cumulative Cash In chart, assembled in the calculate stage. */
  chartUrl: string;
  /** QuickChart URL for the Invoicing vs Cash In chart (last 6 months). */
  invoicingVsCashInChartUrl: string;
  /** QuickChart URL for the A/R Balance Delta chart (last 6 months). */
  arDeltaChartUrl: string;
};

export type RevenueBlockConfig = {
  timezone: string; // IANA timezone
  referenceMonth: string; // "YYYY-MM"
};

type PreparedRecord = {
  status: ReceivableStatus;
  statusRaw: string | null;
  amount: number;
  dueDate: string | null;
  paidDate: string | null;
  referenceMonth: string | null;
  invoiceMonth: string | null;
  nfeStatus: string | null;
  paidMonth: string | null;
  paidDay: number | null;
};

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function normalizeAmount(amount: number | null): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function parseDay(dateStr: string | null): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const day = Number(dateStr.slice(8, 10));
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function shouldIgnoreStatus(status: ReceivableStatus): boolean {
  return status === "unknown" || status === "canceled";
}

function normalizeText(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeMonthKey(dateStr: string | null, timezone: string): string | null {
  if (!dateStr?.trim()) return null;
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [, mm, yyyy] = s.split("/");
    return `${yyyy}-${mm}`;
  }
  return getYearMonth(s, timezone);
}

function isSettledByMonth(record: PreparedRecord, month: string): boolean {
  // Paid records without paidDate are treated as settled for safety.
  if (record.status === "paid" && record.paidMonth === null) return true;
  return record.paidMonth !== null && record.paidMonth <= month;
}

function isInvoicedByMonth(record: PreparedRecord, month: string): boolean {
  return record.invoiceMonth !== null && record.invoiceMonth <= month;
}

function isRevenueMetricRecord(record: PreparedRecord): boolean {
  return !shouldIgnoreStatus(record.status);
}

function prepareRecords(records: CollectRecord[], timezone: string): PreparedRecord[] {
  const prepared: PreparedRecord[] = [];

  for (const record of records) {
    const amount = normalizeAmount(record.amount);
    if (amount === null) continue;

    prepared.push({
      status: record.status,
      statusRaw: record.statusRaw,
      amount,
      dueDate: record.dueDate,
      paidDate: record.paidDate,
      referenceMonth: normalizeMonthKey(record.referenceMonth, timezone),
      invoiceMonth: getYearMonth(record.invoiceCreatedAt, timezone),
      nfeStatus: normalizeText(record.nfeStatus),
      paidMonth: getYearMonth(record.paidDate, timezone),
      paidDay: parseDay(record.paidDate),
    });
  }

  return prepared;
}

function computeArBalanceAtMonth(records: PreparedRecord[], month: string): number {
  let total = 0;

  for (const record of records) {
    if (!isRevenueMetricRecord(record)) continue;
    if (!isInvoicedByMonth(record, month)) continue;
    if (isSettledByMonth(record, month)) continue;
    total += record.amount;
  }

  return total;
}

function computeAllOpenReceivables(records: PreparedRecord[]): number {
  let total = 0;
  let includedCount = 0;
  let excludedCanceled = 0;
  let excludedNotIssued = 0;
  let excludedAlreadyPaid = 0;

  const includedRecords: Array<{ amount: number; dueDate: string | null }> = [];

  for (const record of records) {
    if (record.status === "canceled") {
      excludedCanceled++;
      continue;
    }

    if (record.nfeStatus !== "issued") {
      excludedNotIssued++;
      continue;
    }

    if (record.paidDate !== null) {
      excludedAlreadyPaid++;
      continue;
    }

    // Record passes all filters (no dueDate filter)
    total += record.amount;
    includedCount++;
    includedRecords.push({ amount: record.amount, dueDate: record.dueDate });
  }

  // Sort by amount descending
  includedRecords.sort((a, b) => b.amount - a.amount);

  console.log("[allOpenReceivables] ===== CÁLCULO ALL OPEN RECEIVABLES =====");
  console.log("[allOpenReceivables] Total de registros analisados:", records.length);
  console.log("[allOpenReceivables]");
  console.log("[allOpenReceivables] FILTROS APLICADOS (sem filtro de data):");
  console.log("[allOpenReceivables]   - Excluídos por status=canceled:", excludedCanceled);
  console.log("[allOpenReceivables]   - Excluídos por nfeStatus!=issued:", excludedNotIssued);
  console.log("[allOpenReceivables]   - Excluídos por já pagos (paidDate):", excludedAlreadyPaid);
  console.log("[allOpenReceivables]");
  console.log("[allOpenReceivables] RESULTADO:");
  console.log("[allOpenReceivables]   - Registros incluídos:", includedCount);
  console.log("[allOpenReceivables]   - TOTAL ALL OPEN RECEIVABLES: R$", total.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  console.log("[allOpenReceivables]");

  if (includedRecords.length > 0) {
    console.log("[allOpenReceivables] TOP 10 maiores valores:");
    includedRecords.slice(0, 10).forEach((r, i) => {
      console.log(`[allOpenReceivables]   ${i + 1}. R$ ${r.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | venc: ${r.dueDate ?? "sem data"}`);
    });
  }

  console.log("[allOpenReceivables] ===== FIM CÁLCULO =====");

  return total;
}

function computeMonthMetrics(records: PreparedRecord[], month: string): RevenueMonthMetrics {
  let billedAmount = 0;
  let receivedAmount = 0;

  for (const record of records) {
    if (!isRevenueMetricRecord(record)) continue;

    // Revenue: NFE.io status must be "issued" + group by referenceMonth
    if (record.nfeStatus === "issued" && record.referenceMonth === month) {
      billedAmount += record.amount;
    }

    // Cash In: payments received in this month
    if (record.paidMonth === month) receivedAmount += record.amount;
  }

  return { billedAmount, receivedAmount };
}

function computeExpectedInflow(records: PreparedRecord[], referenceMonth: string): number {
  const lastDay = lastDayOfMonth(referenceMonth);

  // Counters for debugging
  let total = 0;
  let includedCount = 0;
  let excludedCanceled = 0;
  let excludedNotIssued = 0;
  let excludedAlreadyPaid = 0;
  let excludedNoDueDate = 0;
  let excludedFutureDueDate = 0;

  const includedRecords: Array<{ amount: number; dueDate: string | null; status: string; nfeStatus: string | null }> = [];
  const excludedFutureRecords: Array<{ amount: number; dueDate: string | null }> = [];

  for (const record of records) {
    // Check each filter condition separately for detailed logging
    if (record.status === "canceled") {
      excludedCanceled++;
      continue;
    }

    if (record.nfeStatus !== "issued") {
      excludedNotIssued++;
      continue;
    }

    if (record.paidDate !== null) {
      excludedAlreadyPaid++;
      continue;
    }

    if (!record.dueDate) {
      excludedNoDueDate++;
      continue;
    }

    if (record.dueDate > lastDay) {
      excludedFutureDueDate++;
      excludedFutureRecords.push({ amount: record.amount, dueDate: record.dueDate });
      continue;
    }

    // Record passes all filters
    total += record.amount;
    includedCount++;
    includedRecords.push({
      amount: record.amount,
      dueDate: record.dueDate,
      status: record.status,
      nfeStatus: record.nfeStatus,
    });
  }

  // Sort by amount descending for top records
  includedRecords.sort((a, b) => b.amount - a.amount);
  excludedFutureRecords.sort((a, b) => b.amount - a.amount);

  console.log("[expectedInflow] ===== CÁLCULO EXPECTED INFLOW =====");
  console.log("[expectedInflow] Mês de referência:", referenceMonth);
  console.log("[expectedInflow] Último dia do mês:", lastDay);
  console.log("[expectedInflow] Total de registros analisados:", records.length);
  console.log("[expectedInflow]");
  console.log("[expectedInflow] FILTROS APLICADOS:");
  console.log("[expectedInflow]   - Excluídos por status=canceled:", excludedCanceled);
  console.log("[expectedInflow]   - Excluídos por nfeStatus!=issued:", excludedNotIssued);
  console.log("[expectedInflow]   - Excluídos por já pagos (paidDate):", excludedAlreadyPaid);
  console.log("[expectedInflow]   - Excluídos por sem dueDate:", excludedNoDueDate);
  console.log("[expectedInflow]   - Excluídos por dueDate > " + lastDay + ":", excludedFutureDueDate);
  console.log("[expectedInflow]");
  console.log("[expectedInflow] RESULTADO:");
  console.log("[expectedInflow]   - Registros incluídos:", includedCount);
  console.log("[expectedInflow]   - TOTAL EXPECTED INFLOW: R$", total.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  console.log("[expectedInflow]");

  if (includedRecords.length > 0) {
    console.log("[expectedInflow] TOP 10 maiores valores incluídos:");
    includedRecords.slice(0, 10).forEach((r, i) => {
      console.log(`[expectedInflow]   ${i + 1}. R$ ${r.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | venc: ${r.dueDate} | status: ${r.status} | nfe: ${r.nfeStatus}`);
    });
  }

  if (excludedFutureRecords.length > 0) {
    const futureTotal = excludedFutureRecords.reduce((sum, r) => sum + r.amount, 0);
    console.log("[expectedInflow]");
    console.log("[expectedInflow] EXCLUÍDOS POR DATA FUTURA (top 5):");
    console.log("[expectedInflow]   Total excluído: R$", futureTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    excludedFutureRecords.slice(0, 5).forEach((r, i) => {
      console.log(`[expectedInflow]   ${i + 1}. R$ ${r.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | venc: ${r.dueDate}`);
    });
  }

  console.log("[expectedInflow] ===== FIM CÁLCULO =====");

  return total;
}

/**
 * Daily Cash In data used by the cumulative comparison chart.
 *
 * displayDays: current-month elapsed days when month is in progress, otherwise full month.
 * comparisonDays: previous month is truncated to same day for fair MTD comparison.
 */
export type RevenueDailyData = {
  currDailyReceived: Map<number, number>; // day -> daily received
  prevDailyReceived: Map<number, number>;
  displayDays: number;
  comparisonDays: number;
};

export function computeDailyRevenue(
  records: CollectRecord[],
  referenceMonth: string,
  prevMonth: string,
  timezone: string,
): RevenueDailyData {
  const prepared = prepareRecords(records, timezone);

  const currDailyReceived = new Map<number, number>();
  const prevDailyReceived = new Map<number, number>();

  for (const record of prepared) {
    if (record.paidDay === null || record.paidMonth === null) continue;

    if (record.paidMonth === referenceMonth) {
      currDailyReceived.set(record.paidDay, (currDailyReceived.get(record.paidDay) ?? 0) + record.amount);
    } else if (record.paidMonth === prevMonth) {
      prevDailyReceived.set(record.paidDay, (prevDailyReceived.get(record.paidDay) ?? 0) + record.amount);
    }
  }

  const daysInMonth = Number(lastDayOfMonth(referenceMonth).slice(8, 10));
  const daysInPrevMonth = Number(lastDayOfMonth(prevMonth).slice(8, 10));

  const now = new Date();
  const currentYearMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).format(now).slice(0, 7);
  const currentDayOfMonth = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, day: "2-digit" }).format(now),
  );

  const displayDays = currentYearMonth === referenceMonth
    ? Math.min(currentDayOfMonth, daysInMonth)
    : daysInMonth;

  return {
    currDailyReceived,
    prevDailyReceived,
    displayDays,
    comparisonDays: Math.min(displayDays, daysInPrevMonth),
  };
}

function cumulativeSeries(
  dailyMap: Map<number, number>,
  displayDays: number,
  daysElapsed: number,
): (number | null)[] {
  if (dailyMap.size === 0) return Array.from({ length: displayDays }, () => null);

  let running = 0;
  return Array.from({ length: displayDays }, (_, i) => {
    const day = i + 1;
    if (day > daysElapsed) return null;
    running += dailyMap.get(day) ?? 0;
    return Math.round(running);
  });
}

export type ChartTheme = "light" | "dark";

export function buildRevenueChartConfig(data: RevenueDailyData, theme: ChartTheme = "light"): object {
  const { currDailyReceived, prevDailyReceived, displayDays, comparisonDays } = data;

  const labels = Array.from({ length: displayDays }, (_, i) => String(i + 1));
  const prevReceived = cumulativeSeries(prevDailyReceived, displayDays, comparisonDays);
  const currReceived = cumulativeSeries(currDailyReceived, displayDays, displayDays);

  const isDark = theme === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.1)";
  const labelColor = isDark ? "#888888" : "#666666";

  return {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Previous Month (same day)",
          data: prevReceived,
          borderColor: isDark ? "#666666" : "#9ca3af",
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          spanGaps: false,
        },
        {
          label: "Current Month (MTD)",
          data: currReceived,
          borderColor: "#4cb782",
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          spanGaps: false,
        },
      ],
    },
    options: {
      legend: {
        display: true,
        position: "bottom",
        labels: { boxWidth: 12, fontSize: 10, fontColor: labelColor },
      },
      scales: {
        xAxes: [{
          gridLines: { color: gridColor },
          ticks: { fontColor: labelColor },
        }],
        yAxes: [{
          gridLines: { color: gridColor },
          ticks: { beginAtZero: true, fontColor: labelColor },
        }],
      },
    },
  };
}

export function runRevenueBlock(
  records: CollectRecord[],
  config: RevenueBlockConfig,
): Omit<RevenueBlock, "chartUrl" | "invoicingVsCashInChartUrl" | "arDeltaChartUrl"> {
  const { referenceMonth, timezone } = config;
  const prevMonth = previousMonth(referenceMonth);
  const prepared = prepareRecords(records, timezone);

  console.log("[revenue] ===== DADOS COLETADOS =====");
  console.log("[revenue] Total de linhas da view (CollectRecords):", records.length);
  console.log("[revenue] Registros válidos (amount > 0):", prepared.length);
  console.log("[revenue] Registros descartados (amount inválido):", records.length - prepared.length);
  console.log("[revenue] ==============================");

  return {
    referenceMonth,
    current: computeMonthMetrics(prepared, referenceMonth),
    previous: computeMonthMetrics(prepared, prevMonth),
    expectedInflow: computeExpectedInflow(prepared, referenceMonth),
    totalOpen: computeAllOpenReceivables(prepared),
  };
}

export type RevenueHistoricalMonth = {
  month: string; 
  billedAmount: number;
  receivedAmount: number;
  arBalance: number;
  arDelta: number;
};

export function computeHistoricalRevenue(
  records: CollectRecord[],
  referenceMonth: string,
  timezone: string,
  monthsCount: number = 6,
): RevenueHistoricalMonth[] {
  const months: string[] = [referenceMonth];
  let curr = referenceMonth;

  for (let i = 1; i < monthsCount; i++) {
    curr = previousMonth(curr);
    months.push(curr);
  }

  months.reverse();

  const prepared = prepareRecords(records, timezone);
  const results: RevenueHistoricalMonth[] = [];
  const billedByReferenceMonth = new Map<string, number>();

  for (const record of prepared) {
    if (!isRevenueMetricRecord(record)) continue;
    const monthKey = record.referenceMonth ?? record.invoiceMonth;
    if (!monthKey) continue;
    billedByReferenceMonth.set(monthKey, (billedByReferenceMonth.get(monthKey) ?? 0) + record.amount);
  }

  const monthBeforeFirst = previousMonth(months[0]!);
  let prevAr = computeArBalanceAtMonth(prepared, monthBeforeFirst);

  for (const month of months) {
    const metrics = computeMonthMetrics(prepared, month);
    const currAr = computeArBalanceAtMonth(prepared, month);

    results.push({
      month,
      billedAmount: billedByReferenceMonth.get(month) ?? 0,
      receivedAmount: metrics.receivedAmount,
      arBalance: currAr,
      arDelta: currAr - prevAr,
    });

    prevAr = currAr;
  }

  return results;
}

function formatMonth(ym: string): string {
  const month = Number(ym.slice(5, 7));
  return `${MONTHS_PT[month - 1]}/${ym.slice(2, 4)}`;
}

export function buildInvoicingVsCashInChartConfig(history: RevenueHistoricalMonth[], theme: ChartTheme = "light"): object {
  const labels = history.map(item => formatMonth(item.month));
  const invoiced = history.map(item => item.billedAmount);
  const cashIn = history.map(item => item.receivedAmount);
  const gap = history.map(item => item.billedAmount - item.receivedAmount);

  const isDark = theme === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.1)";
  const labelColor = isDark ? "#888888" : "#666666";

  return {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Invoiced (R$)",
          data: invoiced,
          backgroundColor: "#3b82f6",
          borderColor: "#3b82f6",
          borderWidth: 0,
        },
        {
          label: "Cash In (R$)",
          data: cashIn,
          backgroundColor: "#4cb782",
          borderColor: "#4cb782",
          borderWidth: 0,
        },
        {
          label: "Gap (R$)",
          type: "line",
          data: gap,
          borderColor: "#f59e0b",
          borderWidth: 2,
          pointRadius: 2,
          fill: false,
        },
      ],
    },
    options: {
      plugins: { tickFormat: { prefix: "R$ " } },
      legend: {
        position: "bottom",
        labels: { boxWidth: 12, fontSize: 10, fontColor: labelColor },
      },
      scales: {
        xAxes: [{
          gridLines: { color: gridColor },
          ticks: { fontColor: labelColor },
        }],
        yAxes: [{
          gridLines: { color: gridColor },
          ticks: { beginAtZero: true, fontColor: labelColor },
          scaleLabel: { display: true, labelString: "Valor (R$)", fontColor: labelColor },
        }],
      },
    },
  };
}

export function buildArDeltaChartConfig(history: RevenueHistoricalMonth[], theme: ChartTheme = "light"): object {
  const labels = history.map(item => formatMonth(item.month));
  const deltas = history.map(item => item.arDelta);
  const bgColors = deltas.map(delta => {
    if (delta > 0) return "#ef4444";  // increase (worse)
    if (delta < 0) return "#4cb782";  // reduction (better)
    return "#666666";                 // neutral
  });

  const isDark = theme === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.1)";
  const labelColor = isDark ? "#888888" : "#666666";

  return {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "A/R Delta",
          data: deltas,
          backgroundColor: bgColors,
        },
      ],
    },
    options: {
      legend: { display: false },
      scales: {
        xAxes: [{
          gridLines: { color: gridColor },
          ticks: { fontColor: labelColor },
        }],
        yAxes: [{
          gridLines: { color: gridColor, zeroLineColor: "#6b7280", zeroLineWidth: 1.5 },
          ticks: { beginAtZero: true, fontColor: labelColor },
        }],
      },
    },
  };
}
