/**
 * Converts RevenueBlock data into ScorecardNodes.
 *
 * Pure function — no I/O, no side effects.
 */

import type { RevenueBlock } from "../../pipeline/blocks/revenue";
import type { ScorecardNode } from "../nodes";
import { BRL } from "../nodes";
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

export type RevenueNodesConfig = {
  /** URLs for chart images (already uploaded to Linear storage) */
  chartUrls?: {
    cashIn?: string;
    invoicingVsCashIn?: string;
    arDelta?: string;
  };
};

/**
 * Converts RevenueBlock to a list of ScorecardNodes.
 *
 * The nodes represent the revenue section of the scorecard,
 * including metrics with comparisons and charts.
 */
export function revenueToNodes(
  revenue: RevenueBlock,
  config: RevenueNodesConfig = {},
): ScorecardNode[] {
  const { current, previous, referenceMonth, totalOpen } = revenue;
  const { chartUrls } = config;

  const currLabel = yearMonthLabel(referenceMonth);
  const prevLabel = yearMonthLabel(previousMonth(referenceMonth));

  const nodes: ScorecardNode[] = [];

  // Invoiced metric
  nodes.push({
    kind: "metric",
    label: "Invoiced",
    description: `Invoices issued in ${currLabel}`,
    value: current.billedAmount,
    format: BRL,
    comparison: {
      value: previous.billedAmount,
      label: `vs. ${prevLabel}`,
    },
  });

  // Invoicing vs Cash In chart (after Invoiced metric)
  if (chartUrls?.invoicingVsCashIn) {
    nodes.push({
      kind: "chart",
      url: chartUrls.invoicingVsCashIn,
      alt: "Invoicing vs Cash In (last 6 months)",
    });
  }

  // Cash In metric
  nodes.push({
    kind: "metric",
    label: "Cash In",
    description: `Payments confirmed in ${currLabel}`,
    value: current.receivedAmount,
    format: BRL,
    comparison: {
      value: previous.receivedAmount,
      label: `vs. ${prevLabel}`,
    },
  });

  // Outstanding this month metric
  nodes.push({
    kind: "metric",
    label: "Outstanding this month",
    value: revenue.expectedInflow,
    format: BRL,
  });

  // A/R Total metric
  nodes.push({
    kind: "metric",
    label: "A/R Total",
    description: "All open receivables across all months",
    value: totalOpen,
    format: BRL,
  });

  return nodes;
}
