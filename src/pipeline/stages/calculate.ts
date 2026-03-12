/**
 * Calculate stage — orchestrates all business blocks.
 *
 * This file is intentionally thin: it resolves the reference month, calls
 * each block, and merges the results into a single CalculateStageOutput.
 *
 * Adding a new block (e.g. Block 5 — Margin):
 *   1. Create src/pipeline/blocks/margin.ts
 *   2. Import runMarginBlock here
 *   3. Add a `margin` field to CalculateStageOutput
 *   4. Call runMarginBlock inside runCalculateStage
 */

import type { CollectStageOutput } from "../../core/types";
import { toYearMonth } from "../../core/date";
import { runRevenueBlock, computeDailyRevenue, buildRevenueChartConfig, computeHistoricalRevenue, buildInvoicingVsCashInChartConfig, buildArDeltaChartConfig } from "../blocks/revenue";
import type { RevenueBlock } from "../blocks/revenue";
import { collectCostsData, runCostsBlock, buildChartConfig, buildChartUrl } from "../blocks/costs";
import type { CostsBlock } from "../blocks/costs";
import type { CostsRawData } from "../blocks/costs";
import { previousMonth } from "../../core/date";

export { previousMonth } from "../../core/date";

// ---- Types ------------------------------------------------------------------

export type CalculateStageConfig = {
  timezone: string;
  /** Defaults to the current calendar month in the configured timezone. */
  referenceMonth?: string; // "YYYY-MM"
  // Stats Lake (ClickHouse) — required for the costs block
  statsLakeUrl: string;
  statsLakeUser: string;
  statsLakePassword: string;
};

export type CalculateStageDeps = {
  collectCostsDataFn?: (config: {
    statsLakeUrl: string;
    statsLakeUser: string;
    statsLakePassword: string;
  }) => Promise<CostsRawData>;
};

import type { RevenueHistoricalMonth } from "../blocks/revenue";

/** Raw daily cost row (for chart rendering in card). */
export type CostsDailyRow = {
  date: string;
  daily_cost: number;
};

/**
 * Merged output of all calculate blocks.
 * Each new business block adds one field here.
 */
export type CalculateStageOutput = {
  referenceMonth: string;
  revenue: RevenueBlock;
  costs: CostsBlock; // Block 4 — Infrastructure Costs
  // margin: MarginBlock; // Block 5 — Margin & Result

  // Raw data for card chart generation
  revenueHistory: RevenueHistoricalMonth[];
  costsDaily: CostsDailyRow[];
};

// ---- Stage ------------------------------------------------------------------

/**
 * Runs all calculate blocks and returns the merged output.
 * Blocks are independent and do not share mutable state.
 * Async because the costs block fetches from ClickHouse.
 */
export async function runCalculateStage(
  collect: CollectStageOutput,
  config: CalculateStageConfig,
  deps: CalculateStageDeps = {},
): Promise<CalculateStageOutput> {
  const refMonth = config.referenceMonth ?? toYearMonth(new Date(), config.timezone);
  const collectCosts = deps.collectCostsDataFn ?? collectCostsData;

  const rawCosts = await collectCosts({
    statsLakeUrl:      config.statsLakeUrl,
    statsLakeUser:     config.statsLakeUser,
    statsLakePassword: config.statsLakePassword,
  });

  const costsData = runCostsBlock(rawCosts, { referenceMonth: refMonth });
  const chartConfig = buildChartConfig(rawCosts.daily, costsData, previousMonth(refMonth));
  const chartUrl = buildChartUrl(chartConfig);
  const costs: CostsBlock = { ...costsData, chartUrl };

  const prevMonth = previousMonth(refMonth);

  const revenueData       = runRevenueBlock(collect.records, { referenceMonth: refMonth, timezone: config.timezone });
  const revDailyData      = computeDailyRevenue(collect.records, refMonth, prevMonth, config.timezone);
  const revenueChartUrl   = buildChartUrl(buildRevenueChartConfig(revDailyData));
  
  const historyData               = computeHistoricalRevenue(collect.records, refMonth, config.timezone, 6);
  const invoicingVsCashInChartUrl = buildChartUrl(buildInvoicingVsCashInChartConfig(historyData));
  const arDeltaChartUrl           = buildChartUrl(buildArDeltaChartConfig(historyData));

  // Debug: log revenue history for card metrics
  const currMonthData = historyData[historyData.length - 1];
  const prevMonthData = historyData[historyData.length - 2];

  // Count records by referenceMonth for debugging
  const feb2026Records = collect.records.filter(r => {
    const rm = r.referenceMonth;
    return rm && rm.startsWith('2026-02');
  });
  const feb2026ValidRecords = feb2026Records.filter(r => {
    return r.status !== 'unknown' && r.status !== 'canceled' && r.amount && r.amount > 0;
  });
  const feb2026Sum = feb2026ValidRecords.reduce((sum, r) => sum + (r.amount || 0), 0);

  console.log("[calculate] feb2026 debug", {
    totalRecords: feb2026Records.length,
    validRecords: feb2026ValidRecords.length,
    sumFromCollect: feb2026Sum,
    statusBreakdown: feb2026Records.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  });

  console.log("[calculate] revenueHistory", {
    prevMonth: prevMonthData?.month,
    prevBilledAmount: prevMonthData?.billedAmount,
    prevReceivedAmount: prevMonthData?.receivedAmount,
    currMonth: currMonthData?.month,
    currBilledAmount: currMonthData?.billedAmount,
    currReceivedAmount: currMonthData?.receivedAmount,
  });

  const revenue: RevenueBlock = {
    ...revenueData,
    chartUrl: revenueChartUrl,
    invoicingVsCashInChartUrl,
    arDeltaChartUrl
  };

  // Raw data for card chart generation
  const costsDaily: CostsDailyRow[] = rawCosts.daily.map(row => ({
    date: row.date,
    daily_cost: row.daily_cost,
  }));

  return {
    referenceMonth: refMonth,
    revenue,
    costs,
    revenueHistory: historyData,
    costsDaily,
  };
}
