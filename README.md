# WeekStart Automation Worker

Cloudflare Worker for WeekStart automations (scheduled weekly jobs, starting with a minimal “empty worker” foundation).

## What this is

This repository contains a Cloudflare Worker that will run on a weekly schedule (Cron Trigger) and, in future steps, publish an updated WeekStart scorecard into a Linear Document.

For now, the goal is to keep the worker lightweight and production-ready:
- Health endpoint
- Manual trigger endpoint (authenticated)
- Scheduled handler (cron stub)
- Basic observability/logging

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

This worker exposes a manual trigger endpoint:

* `POST /run` (requires `Authorization: Bearer <RUN_KEY>`)

Example:

```bash
curl -X POST http://localhost:8787/run \
  -H "Authorization: Bearer your-key-here"
```

## Scheduled runs (cron)

The worker will use Cloudflare Cron Triggers to execute weekly.

> Note: Cron schedules in Cloudflare run in UTC.

## Secrets / Environment Variables

Required:

* `RUN_KEY` (secret) — protects the manual `/run` endpoint.

## Deploy

Deploy is managed via Cloudflare Workers (UI) connected to this repository (Git integration), or via Wrangler if needed.

Typical Wrangler deploy (if enabled for the repo/account):

```bash
npm run deploy
```
