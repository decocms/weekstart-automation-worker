/**
 * Scorecard AST — typed document tree for the weekly scorecard.
 *
 * The scorecard is represented as a tree of nodes that can be rendered
 * to multiple output formats (markdown, Discord embeds, etc.).
 *
 * Design principles:
 * - Each node is a discriminated union (kind field)
 * - Nodes are pure data, no methods
 * - Rendering is handled by separate functions
 * - Extensible: add new node kinds without changing renderers (they can ignore unknown kinds)
 */

// ---- Formatting hints -------------------------------------------------------

/**
 * How to format a numeric value.
 * Renderers use this to apply locale-specific formatting.
 */
export type ValueFormat =
  | { kind: "currency"; currency: "BRL" }
  | { kind: "percent"; decimals?: number }
  | { kind: "number"; decimals?: number }
  | { kind: "integer" };

// ---- Node types -------------------------------------------------------------

/**
 * A section groups related nodes under a heading.
 */
export type SectionNode = {
  kind: "section";
  title: string;
  children: ScorecardNode[];
};

/**
 * A metric displays a labeled value with optional comparison.
 */
export type MetricNode = {
  kind: "metric";
  label: string;
  description: string;
  value: number;
  format: ValueFormat;
  comparison?: {
    value: number;
    label: string; // e.g. "vs. jan/2024"
  };
};

/**
 * A chart embeds an image URL.
 */
export type ChartNode = {
  kind: "chart";
  url: string;
  alt: string;
};

/**
 * Plain text content.
 */
export type TextNode = {
  kind: "text";
  content: string;
};

/**
 * A group of metrics displayed together (e.g. service breakdown table).
 */
export type MetricGroupNode = {
  kind: "metric_group";
  label: string;
  items: Array<{
    name: string;
    value: number;
    format: ValueFormat;
    delta?: { value: number; format: ValueFormat };
  }>;
};

// ---- Union ------------------------------------------------------------------

export type ScorecardNode =
  | SectionNode
  | MetricNode
  | ChartNode
  | TextNode
  | MetricGroupNode;

// ---- Helpers ----------------------------------------------------------------

/** Shorthand for BRL currency format */
export const BRL: ValueFormat = { kind: "currency", currency: "BRL" };

/** Shorthand for percent format with 1 decimal */
export const PCT: ValueFormat = { kind: "percent", decimals: 1 };

/** Shorthand for integer format */
export const INT: ValueFormat = { kind: "integer" };
