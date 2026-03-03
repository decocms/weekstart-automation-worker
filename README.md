# WeekStart Automation Worker

Cloudflare Worker for WeekStart automations.

## What this is

This repository contains a Cloudflare Worker that runs on a weekly schedule (Cron Trigger) and will publish a weekly scorecard into Linear.

Current foundation already implemented:
- Health endpoint
- Manual trigger endpoint (authenticated)
- Scheduled handler
- Logs and Discord failure alerts

## Planned Pipeline (Scorecard)

The delivery pipeline is defined as:

`collect -> calculate -> consolidate -> test -> publish`

Each stage has one clear responsibility and a stable output contract.

### 1. Collect

Goal:
- Fetch raw data from source systems (finance/data lake/infrastructure/other providers).

Output:
- Normalized raw datasets with run metadata (week, source, timestamps).

Examples of planned scope:
- Revenue: issued invoices / payment status.
- Infrastructure costs: AWS, GCP, Vercel, Cloudflare cost sources.

### 2. Calculate

Goal:
- Convert normalized raw data into weekly indicators.

Output:
- Derived metrics per block.

Examples of planned scope:
- Revenue: total billed, total received, received percentage, total outstanding, expected receipts.
- Costs: month-to-date accumulated cost, month-end projection, comparison with previous period.
- Margin and result: margin, projected revenue, projected cost, expected profit/loss.
- AI block: trend classification (growth/stability/reduction) and explainability inputs.

### 3. Consolidate

Goal:
- Merge all block outputs into one canonical `Scorecard` payload.

Output:
- Single scorecard model with fixed schema for publishing.

Rules:
- Keep deterministic structure every week.
- Include run metadata and traceability (runId, references, timestamps).

### 4. Test

Goal:
- Validate the stage outputs and scorecard contract before publication.

Output:
- Automated test results (unit/integration/contract checks) and publish readiness.

Rules:
- Publishing only happens after pipeline tests pass.
- Critical metric/schema regressions must fail the run.

### 5. Publish

Goal:
- Render and publish the scorecard in the destination channel.

Primary target:
- Linear document used by WeekStart/Weekend process.

Planned constraints:
- Same visual/section format every week.
- Idempotent behavior for reruns (avoid unintended duplicates).

## Roadmap Mapping (Linear sub-issues)

The pipeline supports these planned blocks:
- Block 3: Revenue
- Block 4: Infrastructure Costs
- Block 5: Margin and Result
- Block 6: AI Block
- Block 7: Automatic Executive Summary
- Block 8: Scorecard Publishing

Execution order for delivery:
1. Orchestrator + pipeline contracts
2. Revenue
3. Costs
4. Margin and result
5. AI + executive summary
6. Test coverage and publish gates
7. Final Linear publishing with standardized layout

## Runtime Flow

1. Worker is triggered by cron or by manual `POST /run`.
2. A new `runId` is created and logged.
3. Pipeline stages run in order.
4. Publish runs only if tests pass.
5. On failure, worker logs and sends alert to Discord.
6. Manual rerun can be used for operational recovery.

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

Run locally:

```bash
npm run dev
```

Test health:

```bash
curl http://localhost:8787/health
```

## Manual run (local)

This worker exposes:
- `POST /run` (requires `Authorization: Bearer <RUN_KEY>`)

Example:

```bash
curl -X POST http://localhost:8787/run \
  -H "Authorization: Bearer your-key-here"
```

## Scheduled runs (cron)

The worker uses Cloudflare Cron Triggers (UTC based).

Current schedule is configured in `wrangler.jsonc`.

## Secrets / Environment Variables

Required:
- `RUN_KEY`: protects the manual `/run` endpoint.
- `DISCORD_WEBHOOK_URL`: receives failure alerts.

Optional:
- `WORKER_PUBLIC_URL`: base URL used to build links in alerts.

## Deploy

Deploy is managed via Cloudflare Workers UI (Git integration), or via Wrangler.

Typical Wrangler deploy:

```bash
npm run deploy
```
