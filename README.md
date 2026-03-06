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
└── pipeline/
    ├── blocks/
    │   └── revenue.ts              # Block 3 — Revenue (types + logic, pure functions)
    └── stages/
        ├── collect.ts              # Stage 1 — Airtable fetch + normalization
        ├── calculate.ts            # Stage 2 — Thin orchestrator, calls each block
        ├── consolidate.ts          # Stage 3 — Assembles Scorecard (Scorecard type lives here)
        ├── test.ts                 # Stage 4 — Contract validation (throws on failure)
        └── publish.ts              # Stage 5 — Creates Linear Document

test/
├── collect.spec.ts
├── calculate.spec.ts               # Revenue block tests (unit + integration)
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

### Block 4 — Infrastructure Costs _(planned)_
### Block 5 — Margin and Result _(planned)_
### Block 6 — AI Block _(planned)_
### Block 7 — Automatic Executive Summary _(planned)_

## Publish Stage (`src/pipeline/stages/publish.ts`)

Creates a Linear Document in the configured project on every run. The document uses the "Week end" template structure with the finance scorecard injected inside the "Announcements & distinctions" section.

- Title format: `Week-end | DD/MM/YYYY` (run date in configured timezone)
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

## Deploy

```bash
npm run deploy
```

Deploy is managed via Cloudflare Workers UI (Git integration) or directly via Wrangler.
