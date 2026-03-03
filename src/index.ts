export interface Env {
  RUN_KEY: string;
}

async function runWeekstartStub(meta: Record<string, unknown>) {
  console.log("[weekstart-worker] running stub", JSON.stringify(meta));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (url.pathname === "/run" && request.method === "POST") {
      const auth = request.headers.get("authorization") || "";
      if (auth !== `Bearer ${env.RUN_KEY}`) {
        return new Response("unauthorized", { status: 401 });
      }

      await runWeekstartStub({
        source: "manual",
        at: new Date().toISOString(),
      });

      return new Response("weekstart triggered");
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runWeekstartStub({
        source: "cron",
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
      })
    );
  },
} satisfies ExportedHandler<Env>;