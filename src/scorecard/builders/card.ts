/**
 * Card builder — generates a complete scorecard card from Scorecard data.
 *
 * This builder creates the HTML for the visual scorecard card, including
 * dark-themed charts. The output can be converted to PNG via QuickChart.
 *
 * Pure functions — no I/O, no side effects.
 */

import type { Scorecard } from "../../pipeline/stages/consolidate";
import type { ScorecardNode } from "../nodes";
import { BRL } from "../nodes";
import { previousMonth } from "../../core/date";
import {
  renderToCardHtml,
  buildCardImageRequest,
  type CardConfig,
  type CardSection,
} from "../renderers/card";
import {
  buildInvoicingVsCashInChartConfig,
} from "../../pipeline/blocks/revenue";
import { buildChartConfig as buildCostsChartConfig } from "../../pipeline/blocks/costs";

// ---- Helpers ----------------------------------------------------------------

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function yearMonthLabel(ym: string): string {
  const month = Number(ym.slice(5, 7));
  return `${MONTHS_PT[month - 1]}/${ym.slice(0, 4)}`;
}

function buildDarkChartUrl(chartConfig: object, width = 720, height = 220): string {
  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encoded}&w=${width}&h=${height}&bkg=%231a1a2e`;
}

// ---- Card builder -----------------------------------------------------------

export type CardBuilderConfig = {
  width?: number;
};

export type CardBuilderOutput = {
  html: string;
  request: {
    url: string;
    body: string;
    headers: Record<string, string>;
  };
};

/**
 * Builds the complete scorecard card HTML and QuickChart request.
 *
 * @param scorecard - The consolidated scorecard data
 * @param config - Optional configuration (width)
 * @returns HTML string and QuickChart request details
 */
export function buildScorecardCard(
  scorecard: Scorecard,
  config: CardBuilderConfig = {},
): CardBuilderOutput {
  const { revenue, costs, referenceMonth, revenueHistory, costsDaily } = scorecard;
  const width = config.width ?? 800;

  const currLabel = yearMonthLabel(referenceMonth);
  const prevLabel = yearMonthLabel(previousMonth(referenceMonth));

  // Build dark-themed chart URLs
  const invoicingVsCashInChartUrl = buildDarkChartUrl(
    buildInvoicingVsCashInChartConfig(revenueHistory, "dark"),
    width - 80,
    220,
  );

  const rawCostsDaily = costsDaily.map(row => ({
    date: row.date,
    daily_cost: row.daily_cost,
  }));

  const costsChartUrl = buildDarkChartUrl(
    buildCostsChartConfig(rawCostsDaily, costs, previousMonth(referenceMonth), "dark"),
    width - 80,
    200,
  );

  // Get data from history: last entry is current month, second-to-last is previous
  const currMonthData = revenueHistory[revenueHistory.length - 1]!;
  const prevMonthData = revenueHistory[revenueHistory.length - 2]!;

  console.log("[card] metrics", {
    invoiced: prevMonthData.billedAmount,
    cashIn: currMonthData.receivedAmount,
    prevMonth: prevMonthData.month,
    currMonth: currMonthData.month,
  });

  // Revenue section - Invoiced and Cash In
  const revenueSection: CardSection = {
    title: "Revenue",
    nodes: [
      {
        kind: "metric",
        label: "Invoiced",
        description: `${prevLabel} revenue`,
        value: prevMonthData.billedAmount,
        format: BRL,
      },
      {
        kind: "metric",
        label: "Cash In",
        description: `${currLabel} payments`,
        value: currMonthData.receivedAmount,
        format: BRL,
        comparison: {
          value: prevMonthData.receivedAmount,
          label: `vs ${prevLabel}`,
        },
      },
    ],
  };

  // Invoicing vs Cash In chart
  const revenueChartNode: ScorecardNode = {
    kind: "chart",
    url: invoicingVsCashInChartUrl,
    alt: "Invoicing vs Cash In (last 6 months)",
  };

  // Accounts Receivable section - Outstanding this month + All outstanding
  const arSection: CardSection = {
    title: "Accounts Receivable",
    nodes: [
      {
        kind: "metric",
        label: "Outstanding this month",
        value: revenue.expectedInflow,
        format: BRL,
      },
      {
        kind: "metric",
        label: "All outstanding",
        value: revenue.totalOpen,
        format: BRL,
      },
    ],
  };

  // Infrastructure section - COMMENTED OUT FOR NOW
  // const infraSection: CardSection = {
  //   title: "Infrastructure (GCP)",
  //   nodes: [
  //     {
  //       kind: "metric",
  //       label: `MTD (${costs.daysElapsed} days)`,
  //       description: "Accumulated cost",
  //       value: costs.current.totalCost,
  //       format: BRL,
  //     },
  //     {
  //       kind: "metric",
  //       label: "Projected EOM",
  //       description: `Estimate for end of ${currLabel}`,
  //       value: costs.projectedEOM,
  //       format: BRL,
  //       comparison: costs.previousMonthTotal > 0
  //         ? {
  //             value: costs.previousMonthTotal,
  //             label: `vs ${prevLabel}`,
  //           }
  //         : undefined,
  //     },
  //     {
  //       kind: "metric",
  //       label: "Previous Month",
  //       description: `${prevLabel} total`,
  //       value: costs.previousMonthTotal,
  //       format: BRL,
  //     },
  //     {
  //       kind: "chart",
  //       url: costsChartUrl,
  //       alt: "Daily Cost Trend",
  //     },
  //   ],
  // };

  // Render HTML
  const cardConfig: CardConfig = {
    title: "Finance Scorecard",
    width,
  };

  const html = renderToCardHtml(
    [...revenueSection.nodes, revenueChartNode],
    [arSection],
    cardConfig,
  );

  // Build QuickChart request
  const request = buildCardImageRequest(html, { width, format: "png" });

  return { html, request };
}
