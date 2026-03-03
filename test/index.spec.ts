import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { type Env } from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const baseEnv: Env = {
  RUN_KEY: "test-run-key",
  DISCORD_WEBHOOK_URL: "https://discord.invalid/webhook",
  WORKER_PUBLIC_URL: "https://weekstart-automation-worker.example.workers.dev",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("weekstart worker", () => {
  it("responds ok on /health", async () => {
    const request = new IncomingRequest("https://example.com/health");
    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("rejects /run without bearer token", async () => {
    const request = new IncomingRequest("https://example.com/run", { method: "POST" });
    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("unauthorized");
  });

  it("forces error and attempts Discord alert on /run?forceError=1", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const request = new IncomingRequest("https://example.com/run?forceError=1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${baseEnv.RUN_KEY}`,
      },
    });

    const response = await worker.fetch(request, baseEnv);
    const body = (await response.json()) as { ok: boolean; errorSummary?: string };

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.errorSummary).toContain("Manual forced test error");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(baseEnv.DISCORD_WEBHOOK_URL);
  });

  it("returns 405 on GET /run to make manual test intent explicit", async () => {
    const request = new IncomingRequest("https://example.com/run", { method: "GET" });
    const response = await worker.fetch(request, baseEnv);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.text()).toContain("POST /run");
  });
});
