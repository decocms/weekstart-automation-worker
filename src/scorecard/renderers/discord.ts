/**
 * Discord embed renderer for ScorecardNodes.
 *
 * Renders nodes into Discord embed fields format.
 * Pure function — no I/O, no side effects.
 */

import type { ScorecardNode, ValueFormat } from "../nodes";

// ---- Types ------------------------------------------------------------------

export type DiscordField = {
  name: string;
  value: string;
  inline?: boolean;
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

// ---- Node renderers ---------------------------------------------------------

function renderMetric(node: Extract<ScorecardNode, { kind: "metric" }>): DiscordField {
  const valueStr = formatValue(node.value, node.format);

  let fieldValue = `**${valueStr}**`;
  if (node.comparison) {
    fieldValue += `\n${node.comparison.label}: ${formatValue(node.comparison.value, node.format)}`;
  }

  return {
    name: `${node.label} — ${node.description}`,
    value: fieldValue,
    inline: false,
  };
}

function renderSection(node: Extract<ScorecardNode, { kind: "section" }>): DiscordField[] {
  // For sections, we return all child fields with the section as a header
  const fields: DiscordField[] = [];

  // Add section header as a field
  fields.push({
    name: node.title,
    value: "─".repeat(20),
    inline: false,
  });

  // Render children
  for (const child of node.children) {
    fields.push(...renderNodeToFields(child));
  }

  return fields;
}

function renderMetricGroup(node: Extract<ScorecardNode, { kind: "metric_group" }>): DiscordField {
  const lines = node.items.map(item => {
    let line = `${item.name}: ${formatValue(item.value, item.format)}`;
    if (item.delta) {
      line += ` (${formatValue(item.delta.value, item.delta.format)})`;
    }
    return line;
  });

  return {
    name: node.label,
    value: lines.join("\n"),
    inline: false,
  };
}

// ---- Main renderer ----------------------------------------------------------

function renderNodeToFields(node: ScorecardNode): DiscordField[] {
  switch (node.kind) {
    case "section":
      return renderSection(node);

    case "metric":
      return [renderMetric(node)];

    case "metric_group":
      return [renderMetricGroup(node)];

    case "chart":
      // Charts are not rendered in Discord fields (use image property instead)
      return [];

    case "text":
      // Text nodes become a simple field
      return [{
        name: "\u200B", // zero-width space for "empty" name
        value: node.content,
        inline: false,
      }];
  }
}

/**
 * Renders a list of ScorecardNodes to Discord embed fields.
 *
 * Charts are ignored (use Discord embed's image property separately).
 */
export function renderToDiscordFields(nodes: ScorecardNode[]): DiscordField[] {
  const fields: DiscordField[] = [];

  for (const node of nodes) {
    fields.push(...renderNodeToFields(node));
  }

  return fields;
}
