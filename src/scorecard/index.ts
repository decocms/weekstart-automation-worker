/**
 * Scorecard AST module — typed document tree for the weekly scorecard.
 *
 * This module provides:
 * - Node types for representing scorecard content
 * - Builders for converting block outputs to nodes
 * - Renderers for outputting nodes to various formats
 */

// Types
export type {
  ScorecardNode,
  SectionNode,
  MetricNode,
  ChartNode,
  TextNode,
  MetricGroupNode,
  ValueFormat,
} from "./nodes";

export { BRL, PCT, INT } from "./nodes";

// Builders
export { revenueToNodes, type RevenueNodesConfig } from "./builders/revenue";
export { costsToNodes, type CostsNodesConfig } from "./builders/costs";
export { buildScorecardCard, type CardBuilderConfig, type CardBuilderOutput } from "./builders/card";

// Renderers
export { renderToMarkdown } from "./renderers/markdown";
export { renderToDiscordFields, type DiscordField } from "./renderers/discord";
export {
  renderToCardHtml,
  buildCardImageRequest,
  buildDarkChartUrl,
  applyDarkTheme,
  DARK_CHART_THEME,
  type CardConfig,
  type CardSection,
  type CardImageConfig,
} from "./renderers/card";
export {
  renderScorecardSvg,
  svgToDataUri,
  type SvgCardConfig,
} from "./renderers/svg";
