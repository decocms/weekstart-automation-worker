# WeekStart Automation Worker

Cloudflare Worker that runs on a weekly schedule and publishes a business scorecard to Linear.

## What this is

A Cloudflare Worker triggered by a Cron every week. It collects raw data from source systems, computes business metrics, assembles a canonical Scorecard, validates it, and publishes it to Linear as a Document inside the configured project. Each failed run sends a structured Discord alert.

## Pipeline

```
collect → calculate → consolidate → test → publish
```

Each stage has a single responsibility and a stable output contract.

| Stage | Responsibility | Output |
|---|---|---|
| **collect** | Fetch and normalize raw data from source APIs | `CollectStageOutput` |
| **calculate** | Run all business blocks over collected data | `CalculateStageOutput` |
| **consolidate** | Merge block outputs with run metadata | `Scorecard` |
| **test** | Validate the Scorecard contract before publishing | throws on failure |
| **publish** | Create a Linear Document in the configured project | `PublishStageResult` |

On every successful run a Discord embed is sent with the scorecard metrics and a link to the Linear document.

## Architecture — Block-Based Design

Business logic lives in `src/pipeline/blocks/`. Each block is a self-contained module with its own types and pure functions. The calculate stage is a thin orchestrator that calls each block and merges their outputs.

Adding a new block (e.g. Block 4 — Costs):
1. Create `src/pipeline/blocks/costs.ts` with types + `runCostsBlock`.
2. Import and call it in `src/pipeline/stages/calculate.ts`.
3. Add a `costs` field to `CalculateStageOutput`.
4. Uncomment the `costs` line in `src/pipeline/stages/consolidate.ts`.

## File Structure

```
src/
├── index.ts                        # Worker entry point, HTTP/cron handlers, Discord embeds
├── core/
│   ├── types.ts                    # Collect-layer domain types (CollectRecord, CollectStageOutput, …)
│   └── date.ts                     # Shared date utilities (toYearMonth, previousMonth, getYearMonth)
├── pipeline/
│   ├── blocks/
│   │   ├── revenue.ts              # Block 3 — Revenue (types + logic, pure functions)
│   │   └── costs.ts                # Block 4 — Infrastructure Costs (GCP via ClickHouse)
│   └── stages/
│       ├── collect.ts              # Stage 1 — Airtable fetch + normalization
│       ├── calculate.ts            # Stage 2 — Thin orchestrator, calls each block
│       ├── consolidate.ts          # Stage 3 — Assembles Scorecard (Scorecard type lives here)
│       ├── test.ts                 # Stage 4 — Contract validation (throws on failure)
│       └── publish.ts              # Stage 5 — Creates Linear Document + Scorecard Card
└── scorecard/
    ├── index.ts                    # Exports all scorecard modules
    ├── nodes.ts                    # AST node types (metric, chart, section, text, metric_group)
    ├── builders/
    │   ├── revenue.ts              # Converts RevenueBlock → ScorecardNode[]
    │   ├── costs.ts                # Converts CostsBlock → ScorecardNode[]
    │   └── card.ts                 # Builds complete card HTML from Scorecard (unused)
    └── renderers/
        ├── markdown.ts             # Renders nodes to Linear-compatible markdown
        ├── discord.ts              # Renders nodes to Discord embed fields
        ├── card.ts                 # Renders nodes to HTML (unused, kept for reference)
        └── svg.ts                  # Renders scorecard to SVG image (used by publish)

test/
├── collect.spec.ts
├── calculate.spec.ts               # Revenue block tests (unit + integration)
├── revenue.spec.ts                 # Revenue-specific tests
└── index.spec.ts
```

## Blocks

### Block 3 — Revenue (`src/pipeline/blocks/revenue.ts`)

Computes accounts-receivable metrics from normalized `CollectRecord[]`.

All logic is pure (no I/O, no side effects). Exclusion rules applied before every metric:
- status `unknown` → excluded (data quality issue)
- status `canceled` → excluded (guarded for safety)

**Metrics (reference month + previous month for comparison):**

| Field | Description |
|---|---|
| `billedAmount` | Sum of Valor for records whose NF was emitted (`invoiceCreatedAt`) this month |
| `receivedAmount` | Sum of Valor for records whose payment was confirmed (`paidDate`) this month |
| `expectedInflow` | All `registered`/`overdue` records with `dueDate` (effective due date) on or before the last day of this month |
| `totalOpen` | Snapshot of all `registered`/`overdue` records across all months |

**Note on `expectedInflow`:** uses the `Vencimento` column (effective due date after any renegotiation), not `Vencimento original`. `originalDueDate` is kept on `CollectRecord` for audit purposes only.

### Block 4 — Infrastructure Costs (`src/pipeline/blocks/costs.ts`)

Tracks GCP infrastructure costs with same-period month-over-month comparisons. Data is fetched from ClickHouse (Stats Lake).

**Metrics:**

| Field | Description |
|---|---|
| `current.totalCost` | MTD accumulated cost (first N days of current month) |
| `previous.totalCost` | Same period of previous month (first N days) |
| `previousMonthTotal` | Full previous month total (for context) |
| `projectedEOM` | Weighted projection to end of month (7-day rolling average) |
| `samePeriodDiffPct` | % change vs same period last month |
| `topServices` | Top 10 services by cost with MoM comparison |

### Block 5 — Margin and Result _(planned)_
### Block 6 — AI Block _(planned)_
### Block 7 — Automatic Executive Summary _(planned)_

## Scorecard AST (`src/scorecard/`)

The scorecard uses an AST (Abstract Syntax Tree) architecture for flexible rendering to multiple formats.

### Node Types

| Node | Description |
|---|---|
| `metric` | Labeled value with optional comparison (e.g., "Cash In: R$ 339k vs R$ 528k") |
| `chart` | Image URL with alt text |
| `section` | Groups nodes under a heading |
| `text` | Plain text content |
| `metric_group` | Table of related metrics (e.g., service breakdown) |

### Builders

Convert block outputs to nodes:
- `revenueToNodes(revenue, config)` → revenue metrics + charts
- `costsToNodes(costs, config)` → infrastructure metrics
- `buildScorecardCard(scorecard, config)` → complete card HTML

### Renderers

Convert nodes/data to output formats:
- `renderToMarkdown(nodes)` → Linear-compatible markdown
- `renderToDiscordFields(nodes)` → Discord embed fields
- `renderScorecardSvg(scorecard, config)` → SVG image string (used by publish stage)

## Scorecard Card

The publish stage generates a visual scorecard card as an **SVG image** (no external dependencies). The card features:

- Dark theme with gradient background (#1a1a2e → #16213e)
- Metrics with delta indicators (green/red/neutral)
- Sections for Revenue, A/R, and Infrastructure
- BRL formatting with proper thousand separators

**Flow:**
```
Scorecard → renderScorecardSvg() → SVG string → Linear Upload
```

The card image is the only content in the Finance section — no additional text/markdown is rendered.

## Publish Stage (`src/pipeline/stages/publish.ts`)

Creates a Linear Document in the configured project on every run. The document uses the "Week end" template structure with the finance scorecard card (SVG) injected in the "We are profitable" section.

- Title format: `Week-end | DD/MM/YYYY` (run date in configured timezone)
- Finance section shows only the visual SVG card (no text metrics)
- Skipped gracefully if `LINEAR_API_KEY` or `LINEAR_PROJECT_ID` are not set

## Requirements

- Node.js (LTS recommended)
- npm
- Cloudflare account access (decocms)
- Wrangler (installed as a dev dependency)

## Install

```bash
npm install
```

## Local development

```bash
npm run dev
```

Test health:

```bash
curl http://localhost:8787/health
```

## Manual run (local)

```bash
curl -X POST http://localhost:8787/run \
  -H "Authorization: Bearer your-key-here"
```

Force an error alert (for testing Discord):

```bash
curl -X POST "http://localhost:8787/run?forceError=true" \
  -H "Authorization: Bearer your-key-here"
```

## Tests

```bash
npm test
```

Tests run inside the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`.

## Scheduled runs (cron)

Configured in `wrangler.jsonc`. Uses Cloudflare Cron Triggers (UTC-based).

## Secrets / Environment Variables

Required:
- `RUN_KEY` — protects the manual `/run` endpoint.
- `AIRTABLE_TOKEN` — Airtable Personal Access Token used by the collect stage.

Optional:
- `DISCORD_WEBHOOK_URL` — receives failure alerts and scorecard embeds. Worker runs normally without it.
- `TIMEZONE` — IANA timezone for date calculations. Defaults to `America/Sao_Paulo`.
- `WORKER_PUBLIC_URL` — base URL used to build links in Discord alerts.
- `AIRTABLE_BASE_ID` — defaults to `applTenaA2A7ElyNl`.
- `AIRTABLE_TABLE_ID` — defaults to `tblnpSGZ1jqQhJNnm` (Accounts Receivable).
- `AIRTABLE_VIEW_ID` — defaults to `viwC8eUcFU9tp01dw` (Pelinsari-CeremonyWorker).
- `LINEAR_API_KEY` — Linear Personal API Key. Publish stage is skipped if not set.
- `LINEAR_PROJECT_ID` — UUID of the Linear project to publish documents into.
- `STATS_LAKE_URL` — ClickHouse HTTP endpoint for GCP costs data.
- `STATS_LAKE_USER` — ClickHouse username.
- `STATS_LAKE_PASSWORD` — ClickHouse password.

## Deploy

```bash
npm run deploy
```

Deploy is managed via Cloudflare Workers UI (Git integration) or directly via Wrangler.
