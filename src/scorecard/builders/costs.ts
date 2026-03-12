/**
 * Converts CostsBlock data into ScorecardNodes.
 *
 * Pure function — no I/O, no side effects.
 */

import type { CostsBlock } from "../../pipeline/blocks/costs";
import type { ScorecardNode } from "../nodes";
import { BRL, PCT } from "../nodes";
import { previousMonth } from "../../core/date";

// ---- Helpers ----------------------------------------------------------------

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function yearMonthLabel(ym: string): string {
  const month = Number(ym.slice(5, 7));
  return `${MONTHS_PT[month - 1]}/${ym.slice(0, 4)}`;
}

// ---- Builder ----------------------------------------------------------------

export type CostsNodesConfig = {
  /** URL for cost trend chart (already uploaded to Linear storage) */
  chartUrl?: string;
  /** Whether to include service breakdown */
  includeServiceBreakdown?: boolean;
};

/**
 * Converts CostsBlock to a list of ScorecardNodes.
 *
 * The nodes represent the infrastructure costs section of the scorecard.
 */
export function costsToNodes(
  costs: CostsBlock,
  config: CostsNodesConfig = {},
): ScorecardNode[] {
  const { chartUrl, includeServiceBreakdown = false } = config;
  const {
    referenceMonth,
    daysElapsed,
    current,
    previous,
    previousMonthTotal,
    projectedEOM,
    samePeriodDiffPct,
    topServices,
  } = costs;

  const currLabel = yearMonthLabel(referenceMonth);
  const prevLabel = yearMonthLabel(previousMonth(referenceMonth));

  const nodes: ScorecardNode[] = [];

  // Build comparison text for same period
  const samePeriodComparison = samePeriodDiffPct !== null
    ? `vs. same period ${prevLabel}`
    : undefined;

  // MTD Cost metric
  nodes.push({
    kind: "metric",
    label: "Infra GCP MTD",
    description: `Accumulated cost (first ${daysElapsed} days of ${currLabel})`,
    value: current.totalCost,
    format: BRL,
    ...(samePeriodComparison && {
      comparison: {
        value: previous.totalCost,
        label: samePeriodComparison,
      },
    }),
  });

  // Projected EOM metric
  nodes.push({
    kind: "metric",
    label: "Infra GCP Projected EOM",
    description: `Estimate for end of ${currLabel}`,
    value: projectedEOM,
    format: BRL,
    comparison: {
      value: previousMonthTotal,
      label: `previous month total`,
    },
  });

  // Same period diff percentage (if available)
  if (samePeriodDiffPct !== null) {
    nodes.push({
      kind: "metric",
      label: "Same Period Change",
      description: `vs. first ${daysElapsed} days of ${prevLabel}`,
      value: samePeriodDiffPct,
      format: PCT,
    });
  }

  // Service breakdown (optional)
  if (includeServiceBreakdown && topServices.length > 0) {
    nodes.push({
      kind: "metric_group",
      label: "Top Services",
      items: topServices.map(svc => ({
        name: svc.service,
        value: svc.currentMtd,
        format: BRL,
        ...(svc.diffPct !== null && {
          delta: { value: svc.diffPct, format: PCT },
        }),
      })),
    });
  }

  // Cost trend chart
  if (chartUrl) {
    nodes.push({
      kind: "chart",
      url: chartUrl,
      alt: `GCP cost trend ${currLabel}`,
    });
  }

  return nodes;
}
