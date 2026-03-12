import { runCollectStage } from "./pipeline/stages/collect";
import { runCalculateStage } from "./pipeline/stages/calculate";
import { runConsolidateStage } from "./pipeline/stages/consolidate";
import { runTestStage } from "./pipeline/stages/test";
import { runPublishStage } from "./pipeline/stages/publish";
import type { Scorecard } from "./pipeline/stages/consolidate";
import type { PublishStageResult } from "./pipeline/stages/publish";
import { revenueToNodes, costsToNodes, renderToDiscordFields } from "./scorecard";

export interface Env {
  RUN_KEY: string;
  DISCORD_WEBHOOK_URL?: string;
  WORKER_PUBLIC_URL?: string;
  TIMEZONE?: string;

  // Airtable (Collect stage)
  AIRTABLE_TOKEN?: string;
  AIRTABLE_BASE_ID?: string;
  AIRTABLE_TABLE_ID?: string;
  AIRTABLE_VIEW_ID?: string;

  // Stats Lake / ClickHouse (Costs block)
  STATS_LAKE_URL: string;
  STATS_LAKE_USER: string;
  STATS_LAKE_PASSWORD: string;

  // Linear (Publish stage)
  LINEAR_API_KEY?: string;
  LINEAR_PROJECT_ID?: string;
}

/**
 * ---------- Utilities ----------
 */

type RunSource = "manual" | "cron";

type RunMeta = {
  source: RunSource;
  atIso: string;
  forceError?: boolean;

  cron?: string;
  scheduledTimeIso?: string;
};

type RunOk = { ok: true; runId: string };
type RunErr = { ok: false; runId: string; errorSummary: string };

function nowIso() {
  return new Date().toISOString();
}

function firstLine(s: string) {
  const line = (s.split("\n")[0] ?? s).trim();
  return line.length > 240 ? line.slice(0, 240) + "..." : line;
}

function toErrorString(err: unknown) {
  if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`;
  return String(err);
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function getWorkerBaseUrl(env: Env) {
  return env.WORKER_PUBLIC_URL?.replace(/\/+$/, "") || "";
}

/**
 * ---------- Discord ----------
 *
 * Uses embeds to create clean "cards" in Discord.
 */

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
};

async function sendDiscord(env: Env, payload: { content?: string; embeds?: DiscordEmbed[] }) {
  const webhookUrl = env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.log("[discord] webhook skipped: missing DISCORD_WEBHOOK_URL");
    return;
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.log("[discord] webhook failed", JSON.stringify({ status: resp.status, body: firstLine(body) }));
      return;
    }

    console.log("[discord] webhook delivered", resp.status);
  } catch (err) {
    console.log("[discord] webhook exception", firstLine(toErrorString(err)));
  }
}

function buildFailureEmbed(params: {
  env: Env;
  runId: string;
  meta: RunMeta;
  errorSummary: string;
  errorStack: string;
}): DiscordEmbed {
  const { env, runId, meta, errorSummary, errorStack } = params;

  const baseUrl = getWorkerBaseUrl(env);

  const fields: DiscordEmbed["fields"] = [
    { name: "runId", value: `\`${runId}\``, inline: true },
    { name: "source", value: `\`${meta.source}\``, inline: true },
    { name: "time", value: `\`${meta.atIso}\``, inline: false },
  ];

  if (meta.cron) fields.push({ name: "cron", value: `\`${meta.cron}\``, inline: true });
  if (meta.scheduledTimeIso) {
    fields.push({ name: "scheduledTime", value: `\`${meta.scheduledTimeIso}\``, inline: true });
  }

  if (baseUrl) {
    fields.push(
      { name: "health", value: `${baseUrl}/health`, inline: true },
      { name: "manual re-run", value: `${baseUrl}/run`, inline: true }
    );
  }

  return {
    title: "WeekStart FAILED",
    color: 0xff3b30,
    description: `**Error:** \`${errorSummary}\``,
    fields: [
      ...fields,
      {
        name: "stack (truncated)",
        value: `\`\`\`\n${truncate(errorStack, 1000)}\n\`\`\``,
        inline: false,
      },
    ],
    footer: { text: "weekstart-automation-worker" },
    timestamp: meta.atIso,
  };
}

/**
 * ---------- Scorecard preview embed ----------
 */

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function yearMonthLabel(ym: string): string {
  const month = Number(ym.slice(5, 7));
  return `${MONTHS_PT[month - 1]}/${ym.slice(0, 4)}`;
}

function buildScorecardPreviewEmbed(scorecard: Scorecard, publish?: PublishStageResult): DiscordEmbed {
  const currLabel = yearMonthLabel(scorecard.referenceMonth);

  // Build nodes from scorecard data
  const revenueNodes = revenueToNodes(scorecard.revenue);
  const costsNodes = costsToNodes(scorecard.costs);
  const allNodes = [...revenueNodes, ...costsNodes];

  // Render nodes to Discord fields
  const scorecardFields = renderToDiscordFields(allNodes);

  // Add metadata fields
  const fields: DiscordEmbed["fields"] = [
    ...scorecardFields,
    { name: "runId", value: `\`${scorecard.runId}\``, inline: false },
  ];

  if (publish) {
    fields.push({ name: "Linear document", value: publish.documentUrl, inline: false });
  }

  return {
    title: `Finance Overview · ${currLabel}`,
    description: publish
      ? "Weekly scorecard published to Linear."
      : "Weekly scorecard preview — LINEAR_API_KEY not set, skipped publish.",
    color: publish ? 0x4cb782 : 0x3b82f6,
    fields,
    footer: { text: "weekstart-automation-worker" },
    timestamp: scorecard.generatedAtIso,
  };
}

/**
 * ---------- Core job ----------
 */

async function runWeekstartJob(env: Env, meta: RunMeta, runId: string): Promise<void> {
  if (meta.forceError) {
    throw new Error("Manual forced test error");
  }

  const collect = await runCollectStage({
    token: env.AIRTABLE_TOKEN ?? "",
    baseId: env.AIRTABLE_BASE_ID,
    tableId: env.AIRTABLE_TABLE_ID,
    viewId: env.AIRTABLE_VIEW_ID,
    timezone: env.TIMEZONE ?? "America/Sao_Paulo",
  });

  console.log(
    "[weekstart] collect completed",
    JSON.stringify({ totalRecords: collect.records.length, quality: collect.quality })
  );

  const calculate = await runCalculateStage(collect, {
    timezone:          env.TIMEZONE ?? "America/Sao_Paulo",
    statsLakeUrl:      env.STATS_LAKE_URL,
    statsLakeUser:     env.STATS_LAKE_USER,
    statsLakePassword: env.STATS_LAKE_PASSWORD,
  });

  console.log(
    "[weekstart] calculate completed",
    JSON.stringify({ referenceMonth: calculate.revenue.referenceMonth })
  );

  const scorecard = runConsolidateStage(calculate, runId);

  runTestStage(scorecard); // throws if contract is violated

  console.log("[weekstart] scorecard ready", JSON.stringify({ referenceMonth: scorecard.referenceMonth }));

  let publishResult: PublishStageResult | undefined;
  if (env.LINEAR_API_KEY && env.LINEAR_PROJECT_ID) {
    publishResult = await runPublishStage(scorecard, {
      linearApiKey: env.LINEAR_API_KEY,
      linearProjectId: env.LINEAR_PROJECT_ID,
      timezone: env.TIMEZONE ?? "America/Sao_Paulo",
    });
    console.log("[weekstart] published", JSON.stringify({ documentId: publishResult.documentId, documentUrl: publishResult.documentUrl }));
  } else {
    console.log("[weekstart] publish skipped: LINEAR_API_KEY or LINEAR_PROJECT_ID not set");
  }

  await sendDiscord(env, { embeds: [buildScorecardPreviewEmbed(scorecard, publishResult)] });
}

/**
 * Wraps execution with:
 * - runId generation
 * - structured logging
 * - Discord alert on failure
 */
async function runWithAlerts(env: Env, meta: RunMeta): Promise<RunOk | RunErr> {
  const runId = crypto.randomUUID();

  try {
    console.log("[weekstart] start", JSON.stringify({ runId, ...meta }));
    await runWeekstartJob(env, meta, runId);
    console.log("[weekstart] success", JSON.stringify({ runId, ...meta }));
    return { ok: true, runId };
  } catch (err) {
    const errorStack = toErrorString(err);
    const errorSummary = firstLine(errorStack);

    console.log("[weekstart] failed", JSON.stringify({ runId, ...meta, errorSummary }));

    const embed = buildFailureEmbed({ env, runId, meta, errorSummary, errorStack });
    await sendDiscord(env, { embeds: [embed] });

    return { ok: false, runId, errorSummary };
  }
}

/**
 * ---------- HTTP Helpers ----------
 */

function unauthorized() {
  return new Response("unauthorized", { status: 401 });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requireBearer(request: Request, token: string) {
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${token}`;
}

function parseForceErrorFlag(value: string | null) {
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/**
 * ---------- Worker ----------
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return new Response("ok");

    if (url.pathname === "/run") {
      if (request.method !== "POST") {
        return new Response("method not allowed: use POST /run", {
          status: 405,
          headers: { Allow: "POST" },
        });
      }

      if (!requireBearer(request, env.RUN_KEY)) return unauthorized();

      const forceError = parseForceErrorFlag(url.searchParams.get("forceError"));

      const result = await runWithAlerts(env, {
        source: "manual",
        atIso: nowIso(),
        ...(forceError ? { forceError: true } : {}),
      });

      return result.ok ? json(200, result) : json(500, result);
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const result = await runWithAlerts(env, {
          source: "cron",
          atIso: nowIso(),
          cron: controller.cron,
          scheduledTimeIso: new Date(controller.scheduledTime).toISOString(),
        });

        if (!result.ok) throw new Error(result.errorSummary);
      })()
    );
  },
} satisfies ExportedHandler<Env>;

