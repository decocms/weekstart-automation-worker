/**
 * Markdown renderer for ScorecardNodes.
 *
 * Renders a tree of nodes into a markdown string suitable for Linear documents.
 * Pure function — no I/O, no side effects.
 */

import type { ScorecardNode, ValueFormat } from "../nodes";

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
      // Fallback for unknown currencies
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

// ---- Node renderers ---------------------------------------------------------

function renderMetric(node: Extract<ScorecardNode, { kind: "metric" }>): string {
  const lines: string[] = [];

  lines.push(`> **${node.label}** — ${node.description}`);
  lines.push(`> **${formatValue(node.value, node.format)}**`);

  if (node.comparison) {
    lines.push(`> ${node.comparison.label}: ${formatValue(node.comparison.value, node.format)}`);
  }

  return lines.join("\n");
}

function renderChart(node: Extract<ScorecardNode, { kind: "chart" }>): string {
  return `![${node.alt}](${node.url})`;
}

function renderText(node: Extract<ScorecardNode, { kind: "text" }>): string {
  return node.content;
}

function renderSection(node: Extract<ScorecardNode, { kind: "section" }>): string {
  const lines: string[] = [];
  lines.push(`### ${node.title}`);
  lines.push("");

  for (const child of node.children) {
    lines.push(renderNode(child));
    lines.push("");
  }

  return lines.join("\n");
}

function renderMetricGroup(node: Extract<ScorecardNode, { kind: "metric_group" }>): string {
  const lines: string[] = [];

  lines.push(`**${node.label}:**`);
  lines.push("");

  for (const item of node.items) {
    let line = `- ${item.name}: ${formatValue(item.value, item.format)}`;
    if (item.delta) {
      line += ` (${formatValue(item.delta.value, item.delta.format)})`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

// ---- Main renderer ----------------------------------------------------------

function renderNode(node: ScorecardNode): string {
  switch (node.kind) {
    case "section":
      return renderSection(node);
    case "metric":
      return renderMetric(node);
    case "chart":
      return renderChart(node);
    case "text":
      return renderText(node);
    case "metric_group":
      return renderMetricGroup(node);
  }
}

/**
 * Renders a list of ScorecardNodes to markdown.
 *
 * Each node is rendered and separated by a blank line.
 */
export function renderToMarkdown(nodes: ScorecardNode[]): string {
  const parts: string[] = [];

  for (const node of nodes) {
    parts.push(renderNode(node));
  }

  return parts.join("\n\n");
}
