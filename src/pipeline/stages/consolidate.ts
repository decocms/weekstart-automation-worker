/**
 * Consolidate stage — assembles the canonical Scorecard from all block outputs.
 *
 * The Scorecard type is defined here because it is the direct output of this
 * stage. Both the test stage and the worker entry point import it from here.
 */

import type { CalculateStageOutput } from "./calculate";

// ---- Types ------------------------------------------------------------------

/**
 * The canonical scorecard published every week.
 * Each field maps 1-to-1 to a business block from the calculate stage.
 *
 * When a new block is added to CalculateStageOutput, add the corresponding
 * field here so it flows through to the test and publish stages.
 */
export type Scorecard = {
  runId: string;
  referenceMonth: string; // "YYYY-MM"
  generatedAtIso: string;
  revenue: CalculateStageOutput["revenue"];
  costs: CalculateStageOutput["costs"]; // Block 4
  // margin: CalculateStageOutput["margin"]; // Block 5
};

// ---- Stage ------------------------------------------------------------------

/** Merges calculate output with run metadata into the final Scorecard. */
export function runConsolidateStage(calculate: CalculateStageOutput, runId: string): Scorecard {
  return {
    runId,
    referenceMonth: calculate.referenceMonth,
    generatedAtIso: new Date().toISOString(),
    revenue: calculate.revenue,
    costs: calculate.costs,
  };
}
