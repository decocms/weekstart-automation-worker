export interface Env {
  RUN_KEY: string;
  DISCORD_WEBHOOK_URL: string;

  // Optional but useful for nicer links in alerts
  WORKER_PUBLIC_URL?: string; // e.g. "https://weekstart-automation-worker.deco-cx.workers.dev"
}

/**
 * ---------- Utilities ----------
 */

type RunSource = "manual" | "cron";

type RunMeta = {
  source: RunSource;
  atIso: string;

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
}) {
  const { env, runId, meta, errorSummary, errorStack } = params;

  const baseUrl = getWorkerBaseUrl(env);
  const title = "WeekStart FAILED";

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

  const stackForDiscord = truncate(errorStack, 1000);

  const embed: DiscordEmbed = {
    title,
    color: 0xff3b30,
    description: `**Error:** \`${errorSummary}\``,
    fields: [
      ...fields,
      {
        name: "stack (truncated)",
        value: `\`\`\`\n${stackForDiscord}\n\`\`\``,
        inline: false,
      },
    ],
    footer: { text: "weekstart-automation-worker" },
    timestamp: meta.atIso,
  };

  return embed;
}

/**
 * ---------- Core job ----------
 */

async function runWeekstartJob(_env: Env, _meta: RunMeta): Promise<void> {
  if (_meta.cron === "forced-test-error") {
    throw new Error("Manual forced test error");
  }
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
    await runWeekstartJob(env, meta);
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
        ...(forceError ? { cron: "forced-test-error" } : {}),
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
