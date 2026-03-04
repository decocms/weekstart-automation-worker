/**
 * Calculate stage — orchestrates all business blocks.
 *
 * This file is intentionally thin: it resolves the reference month, calls
 * each block, and merges the results into a single CalculateStageOutput.
 *
 * Adding a new block (e.g. Block 4 — Costs):
 *   1. Create src/pipeline/blocks/costs.ts
 *   2. Import runCostsBlock here
 *   3. Add a `costs` field to CalculateStageOutput
 *   4. Call runCostsBlock inside runCalculateStage
 */

import type { CollectStageOutput } from "../../core/types";
import { toYearMonth } from "../../core/date";
import { runRevenueBlock } from "../blocks/revenue";
import type { RevenueBlock } from "../blocks/revenue";

export { previousMonth } from "../../core/date";

// ---- Types ------------------------------------------------------------------

export type CalculateStageConfig = {
  timezone: string;
  /** Defaults to the current calendar month in the configured timezone. */
  referenceMonth?: string; // "YYYY-MM"
};

/**
 * Merged output of all calculate blocks.
 * Each new business block adds one field here.
 */
export type CalculateStageOutput = {
  referenceMonth: string;
  revenue: RevenueBlock;
  // costs: CostsBlock;   // Block 4 — Infrastructure Costs
  // margin: MarginBlock; // Block 5 — Margin & Result
};

// ---- Stage ------------------------------------------------------------------

/**
 * Runs all calculate blocks over the collected records and returns the merged
 * output. Blocks are independent and do not share mutable state.
 */
export function runCalculateStage(
  collect: CollectStageOutput,
  config: CalculateStageConfig,
): CalculateStageOutput {
  const refMonth = config.referenceMonth ?? toYearMonth(new Date(), config.timezone);

  return {
    referenceMonth: refMonth,
    revenue: runRevenueBlock(collect.records, {
      referenceMonth: refMonth,
      timezone: config.timezone,
    }),
  };
}
