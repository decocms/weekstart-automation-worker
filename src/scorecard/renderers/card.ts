/**
 * Card renderer for ScorecardNodes.
 *
 * Renders a tree of nodes into an HTML string suitable for conversion to PNG
 * via QuickChart's /v1/image endpoint. The design follows a dark theme with
 * gradient background, matching the deco.cx brand.
 *
 * Pure functions — no I/O, no side effects.
 */

import type { ScorecardNode, ValueFormat } from "../nodes";

// ---- Types ------------------------------------------------------------------

export type CardConfig = {
  title: string;
  period: string;
  width?: number;
};

export type CardSection = {
  title: string;
  nodes: ScorecardNode[];
};

// ---- Value formatting -------------------------------------------------------

function formatValue(value: number, format: ValueFormat): string {
  switch (format.kind) {
    case "currency": {
      if (format.currency === "BRL") {
        const fixed = Math.abs(value).toFixed(2);
        const [int, dec] = fixed.split(".");
        const intFmt = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        const prefix = value < 0 ? "-" : "";
        return `${prefix}R$ ${intFmt},${dec}`;
      }
      return value.toFixed(2);
    }

    case "percent": {
      const decimals = format.decimals ?? 1;
      const prefix = value >= 0 ? "+" : "";
      return `${prefix}${value.toFixed(decimals)}%`;
    }

    case "number": {
      const decimals = format.decimals ?? 2;
      return value.toFixed(decimals);
    }

    case "integer":
      return Math.round(value).toString();
  }
}

function getDeltaClass(current: number, previous: number): string {
  if (current < previous) return "delta-down";
  if (current > previous) return "delta-up";
  return "delta-neutral";
}

function computeDeltaPercent(current: number, previous: number): string {
  if (previous === 0) return "—";
  const pct = ((current - previous) / previous) * 100;
  const prefix = pct >= 0 ? "+" : "";
  return `${prefix}${pct.toFixed(1)}%`;
}

// ---- CSS --------------------------------------------------------------------

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    padding: 28px 36px;
    color: #fff;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .title {
    font-size: 14px;
    font-weight: 600;
    color: #4cb782;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .period {
    font-size: 13px;
    color: #888;
  }
  .metrics {
    display: flex;
    gap: 16px;
  }
  .metric {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 16px;
  }
  .metric-label {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .metric-value {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
  }
  .metric-delta {
    font-size: 12px;
    font-weight: 500;
  }
  .delta-down { color: #ef4444; }
  .delta-up { color: #4cb782; }
  .delta-neutral { color: #888; }
  .section-divider {
    border-top: 1px solid rgba(255,255,255,0.1);
    margin: 24px 0;
    padding-top: 20px;
  }
  .section-title {
    font-size: 11px;
    color: #4cb782;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 16px;
  }
  .chart-container {
    background: rgba(0,0,0,0.2);
    border-radius: 10px;
    padding: 16px;
    margin-top: 20px;
  }
  .chart-title {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
  }
  .chart-img {
    width: 100%;
    border-radius: 8px;
  }
`.trim();

// ---- HTML builders ----------------------------------------------------------

function renderMetricHtml(node: Extract<ScorecardNode, { kind: "metric" }>): string {
  const deltaClass = node.comparison
    ? getDeltaClass(node.value, node.comparison.value)
    : "delta-neutral";

  const deltaText = node.comparison
    ? `${computeDeltaPercent(node.value, node.comparison.value)} ${node.comparison.label}`
    : node.description;

  return `
    <div class="metric">
      <div class="metric-label">${escapeHtml(node.label)}</div>
      <div class="metric-value">${escapeHtml(formatValue(node.value, node.format))}</div>
      <div class="metric-delta ${deltaClass}">${escapeHtml(deltaText)}</div>
    </div>
  `.trim();
}

function renderChartHtml(node: Extract<ScorecardNode, { kind: "chart" }>): string {
  return `
    <div class="chart-container">
      <div class="chart-title">${escapeHtml(node.alt)}</div>
      <img class="chart-img" src="${escapeHtml(node.url)}" alt="${escapeHtml(node.alt)}">
    </div>
  `.trim();
}

function renderMetricGroupHtml(nodes: ScorecardNode[]): string {
  const metrics = nodes.filter((n): n is Extract<ScorecardNode, { kind: "metric" }> => n.kind === "metric");
  if (metrics.length === 0) return "";

  return `
    <div class="metrics">
      ${metrics.map(renderMetricHtml).join("\n")}
    </div>
  `.trim();
}

function renderSectionHtml(section: CardSection): string {
  const metrics = section.nodes.filter(n => n.kind === "metric");
  const charts = section.nodes.filter(n => n.kind === "chart");

  let html = `<div class="section-divider">`;
  html += `<div class="section-title">${escapeHtml(section.title)}</div>`;

  if (metrics.length > 0) {
    html += renderMetricGroupHtml(metrics);
  }

  for (const chart of charts) {
    if (chart.kind === "chart") {
      html += renderChartHtml(chart);
    }
  }

  html += `</div>`;
  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Main renderer ----------------------------------------------------------

/**
 * Renders ScorecardNodes to HTML for card image generation.
 *
 * @param nodes - Flat list of scorecard nodes
 * @param sections - Optional grouping of nodes into named sections
 * @param config - Card configuration (title, period, width)
 */
export function renderToCardHtml(
  nodes: ScorecardNode[],
  sections: CardSection[],
  config: CardConfig,
): string {
  const width = config.width ?? 800;

  // Top-level metrics (before any section)
  const topMetrics = nodes.filter(n => n.kind === "metric");
  const topCharts = nodes.filter(n => n.kind === "chart");

  let body = `
    <div class="header">
      <div class="title">${escapeHtml(config.title)}</div>
      <div class="period">${escapeHtml(config.period)}</div>
    </div>
  `;

  // Render top-level metrics
  if (topMetrics.length > 0) {
    body += renderMetricGroupHtml(topMetrics);
  }

  // Render top-level charts
  for (const chart of topCharts) {
    if (chart.kind === "chart") {
      body += renderChartHtml(chart);
    }
  }

  // Render sections
  for (const section of sections) {
    body += renderSectionHtml(section);
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${CSS}</style>
</head>
<body style="width: ${width}px;">
  ${body}
</body>
</html>
  `.trim();
}

// ---- QuickChart integration -------------------------------------------------

export type CardImageConfig = {
  width?: number;
  format?: "png" | "webp";
};

/**
 * Generates a QuickChart URL that renders HTML to an image.
 *
 * QuickChart's /v1/image endpoint accepts HTML and returns a PNG.
 * This function builds the request body for that endpoint.
 *
 * Note: The actual fetch must be done by the caller (I/O isolation).
 */
export function buildCardImageRequest(
  html: string,
  config: CardImageConfig = {},
): { url: string; body: string; headers: Record<string, string> } {
  const width = config.width ?? 800;
  const format = config.format ?? "png";

  return {
    url: "https://quickchart.io/v1/image",
    body: JSON.stringify({
      html,
      width,
      format,
    }),
    headers: {
      "Content-Type": "application/json",
    },
  };
}

// ---- Dark theme chart config ------------------------------------------------

/**
 * Theme configuration for QuickChart charts that match the card design.
 */
export const DARK_CHART_THEME = {
  backgroundColor: "#1a1a2e",
  gridColor: "rgba(255,255,255,0.05)",
  labelColor: "#888888",
  legendColor: "#888888",
} as const;

/**
 * Applies dark theme to a Chart.js config object.
 * Mutates the config in place and returns it.
 */
export function applyDarkTheme<T extends object>(chartConfig: T): T {
  const config = chartConfig as Record<string, unknown>;

  if (!config.options) {
    config.options = {};
  }

  const options = config.options as Record<string, unknown>;

  // Legend
  if (!options.legend) options.legend = {};
  const legend = options.legend as Record<string, unknown>;
  legend.position = legend.position ?? "bottom";
  if (!legend.labels) legend.labels = {};
  const legendLabels = legend.labels as Record<string, unknown>;
  legendLabels.fontColor = DARK_CHART_THEME.labelColor;
  legendLabels.boxWidth = legendLabels.boxWidth ?? 12;
  legendLabels.fontSize = legendLabels.fontSize ?? 10;

  // Scales
  if (!options.scales) options.scales = {};
  const scales = options.scales as Record<string, unknown>;

  // X Axes
  if (!scales.xAxes) scales.xAxes = [{}];
  const xAxes = scales.xAxes as Array<Record<string, unknown>>;
  for (const axis of xAxes) {
    if (!axis.gridLines) axis.gridLines = {};
    const grid = axis.gridLines as Record<string, unknown>;
    grid.color = DARK_CHART_THEME.gridColor;
    grid.zeroLineColor = "rgba(255,255,255,0.1)";

    if (!axis.ticks) axis.ticks = {};
    const ticks = axis.ticks as Record<string, unknown>;
    ticks.fontColor = DARK_CHART_THEME.labelColor;
  }

  // Y Axes
  if (!scales.yAxes) scales.yAxes = [{}];
  const yAxes = scales.yAxes as Array<Record<string, unknown>>;
  for (const axis of yAxes) {
    if (!axis.gridLines) axis.gridLines = {};
    const grid = axis.gridLines as Record<string, unknown>;
    grid.color = DARK_CHART_THEME.gridColor;
    grid.zeroLineColor = "rgba(255,255,255,0.1)";

    if (!axis.ticks) axis.ticks = {};
    const ticks = axis.ticks as Record<string, unknown>;
    ticks.fontColor = DARK_CHART_THEME.labelColor;
    ticks.beginAtZero = ticks.beginAtZero ?? true;
  }

  return chartConfig;
}

/**
 * Builds a QuickChart URL with dark theme applied.
 */
export function buildDarkChartUrl(chartConfig: object, width = 720, height = 220): string {
  const themed = applyDarkTheme({ ...chartConfig });
  const encoded = encodeURIComponent(JSON.stringify(themed));
  return `https://quickchart.io/chart?c=${encoded}&w=${width}&h=${height}&bkg=${encodeURIComponent(DARK_CHART_THEME.backgroundColor)}`;
}
