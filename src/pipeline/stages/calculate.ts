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
import { runRevenueBlock, computeDailyRevenue, buildRevenueChartConfig } from "../blocks/revenue";
import type { RevenueBlock } from "../blocks/revenue";
import { collectCostsData, runCostsBlock, buildChartConfig, buildChartUrl } from "../blocks/costs";
import type { CostsBlock } from "../blocks/costs";
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

/**
 * Merged output of all calculate blocks.
 * Each new business block adds one field here.
 */
export type CalculateStageOutput = {
  referenceMonth: string;
  revenue: RevenueBlock;
  costs: CostsBlock; // Block 4 — Infrastructure Costs
  // margin: MarginBlock; // Block 5 — Margin & Result
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
): Promise<CalculateStageOutput> {
  const refMonth = config.referenceMonth ?? toYearMonth(new Date(), config.timezone);

  const rawCosts = await collectCostsData({
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
  const revenue: RevenueBlock = { ...revenueData, chartUrl: revenueChartUrl };

  return { referenceMonth: refMonth, revenue, costs };
}
