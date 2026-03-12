/**
 * SVG renderer for scorecard card.
 *
 * Generates an SVG string that can be uploaded to Linear as an image.
 * No external dependencies required.
 */

import type { Scorecard } from "../../pipeline/stages/consolidate";
import { previousMonth } from "../../core/date";

// ---- Helpers ----------------------------------------------------------------

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function yearMonthLabel(ym: string): string {
  const month = Number(ym.slice(5, 7));
  return `${MONTHS_EN[month - 1]}/${ym.slice(0, 4)}`;
}

function formatBRL(value: number): string {
  const fixed = Math.abs(value).toFixed(2);
  const [int, dec] = fixed.split(".");
  const intFmt = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const prefix = value < 0 ? "-" : "";
  return `${prefix}R$ ${intFmt},${dec}`;
}

function formatBRLShort(value: number): string {
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `R$ ${(value / 1_000).toFixed(0)}k`;
  }
  return `R$ ${value.toFixed(0)}`;
}

function computeDeltaPercent(current: number, previous: number): string {
  if (previous === 0) return "—";
  const pct = ((current - previous) / previous) * 100;
  const prefix = pct >= 0 ? "+" : "";
  return `${prefix}${pct.toFixed(1)}%`;
}

function getDeltaColor(current: number, previous: number): string {
  if (current < previous) return "#ef4444"; // red - down
  if (current > previous) return "#4cb782"; // green - up
  return "#888888"; // neutral
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---- SVG Components ---------------------------------------------------------

type MetricData = {
  label: string;
  value: string;
  delta?: string;
  deltaColor?: string;
};

function renderMetricBox(metric: MetricData, x: number, y: number, width: number): string {
  return `
    <g transform="translate(${x}, ${y})">
      <rect x="0" y="0" width="${width}" height="80" rx="8" fill="rgba(255,255,255,0.05)"/>
      <text x="16" y="24" font-size="11" fill="#888888" font-family="system-ui, sans-serif" text-transform="uppercase">${escapeXml(metric.label)}</text>
      <text x="16" y="52" font-size="20" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="700">${escapeXml(metric.value)}</text>
      ${metric.delta ? `<text x="16" y="72" font-size="12" fill="${metric.deltaColor || '#888888'}" font-family="system-ui, sans-serif">${escapeXml(metric.delta)}</text>` : ''}
    </g>
  `;
}

function renderSectionTitle(title: string, x: number, y: number): string {
  return `<text x="${x}" y="${y}" font-size="11" fill="#4cb782" font-family="system-ui, sans-serif" font-weight="600" text-transform="uppercase" letter-spacing="0.5">${escapeXml(title)}</text>`;
}

function renderDivider(y: number, width: number): string {
  return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
}

// ---- Main renderer ----------------------------------------------------------

export type SvgCardConfig = {
  width?: number;
};

/**
 * Renders the scorecard as an SVG string.
 */
export function renderScorecardSvg(
  scorecard: Scorecard,
  config: SvgCardConfig = {},
): string {
  const width = config.width ?? 700;
  const { revenue, costs, referenceMonth, revenueHistory } = scorecard;

  const currLabel = yearMonthLabel(referenceMonth);
  const prevLabel = yearMonthLabel(previousMonth(referenceMonth));

  // Get data from history: last = current month, second-to-last = previous
  const currMonthData = revenueHistory[revenueHistory.length - 1]!;
  const prevMonthData = revenueHistory[revenueHistory.length - 2]!;

  const padding = 28;
  const metricWidth = (width - padding * 2 - 32) / 3; // 3 columns with gaps
  const metricWidth2 = (width - padding * 2 - 16) / 2; // 2 columns

  let y = padding;
  let content = "";

  // Header
  content += `
    <text x="${padding}" y="${y + 14}" font-size="14" fill="#4cb782" font-family="system-ui, sans-serif" font-weight="600" letter-spacing="1">FINANCE SCORECARD</text>
    <text x="${width - padding}" y="${y + 14}" font-size="13" fill="#888888" font-family="system-ui, sans-serif" text-anchor="end">${escapeXml(currLabel)}</text>
  `;
  y += 30;
  content += renderDivider(y, width);
  y += 24;

  // Revenue Section - Revenue and Cash In (2 columns)
  content += renderSectionTitle("Revenue", padding, y);
  y += 20;

  content += renderMetricBox({
    label: `Revenue ${prevLabel}`,
    value: formatBRL(prevMonthData.billedAmount),
  }, padding, y, metricWidth2);

  content += renderMetricBox({
    label: `Cash In ${currLabel}`,
    value: formatBRL(currMonthData.receivedAmount),
  }, padding + metricWidth2 + 16, y, metricWidth2);

  y += 100;

  // Receivables Section - Outstanding this month + All outstanding (2 columns)
  content += renderDivider(y, width);
  y += 20;
  content += renderSectionTitle("Accounts Receivable", padding, y);
  y += 20;

  content += renderMetricBox({
    label: "Outstanding this month",
    value: formatBRL(revenue.expectedInflow),
  }, padding, y, metricWidth2);

  content += renderMetricBox({
    label: "All outstanding",
    value: formatBRL(revenue.totalOpen),
  }, padding + metricWidth2 + 16, y, metricWidth2);

  y += 100;

  // Infrastructure Section - COMMENTED OUT FOR NOW
  // content += renderDivider(y, width);
  // y += 20;
  // content += renderSectionTitle("Infrastructure (GCP)", padding, y);
  // y += 20;

  // const projectedDelta = costs.previousMonthTotal > 0
  //   ? computeDeltaPercent(costs.projectedEOM, costs.previousMonthTotal)
  //   : "—";

  // content += renderMetricBox({
  //   label: `MTD (${costs.daysElapsed} days)`,
  //   value: formatBRL(costs.current.totalCost),
  //   delta: "accumulated",
  //   deltaColor: "#888888",
  // }, padding, y, metricWidth);

  // content += renderMetricBox({
  //   label: "Projected EOM",
  //   value: formatBRL(costs.projectedEOM),
  //   delta: `${projectedDelta} vs ${prevLabel}`,
  //   deltaColor: costs.previousMonthTotal > 0
  //     ? getDeltaColor(costs.projectedEOM, costs.previousMonthTotal)
  //     : "#888888",
  // }, padding + metricWidth + 16, y, metricWidth);

  // content += renderMetricBox({
  //   label: "Previous Month",
  //   value: formatBRL(costs.previousMonthTotal),
  //   delta: `${prevLabel} total`,
  //   deltaColor: "#888888",
  // }, padding + (metricWidth + 16) * 2, y, metricWidth);

  // y += 100;

  const height = y + padding;

  // Build final SVG
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" rx="16"/>
  ${content}
</svg>`;
}

/**
 * Converts SVG string to a data URI for embedding.
 */
export function svgToDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml,${encoded}`;
}
