import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { breadcrumb } from "../src/index.js";
import { sqlite } from "../src/adapters/index.js";
import { toNextHandler } from "../src/next.js";

const NOW_NS = String(BigInt(Date.now()) * 1_000_000n);
const LATER_NS = String((BigInt(Date.now()) + 800n) * 1_000_000n);

function makeBc(extra: Record<string, unknown> = {}) {
  return breadcrumb({
    database: sqlite(new Database(":memory:")),
    basePath: "/admin/traces",
    environment: "test",
    ingest: { apiKey: "sekrit" },
    ...extra,
  });
}

const OTLP_BODY = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "python-worker" } },
          { key: "deployment.environment.name", value: { stringValue: "production" } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "opentelemetry.instrumentation.openai" },
          spans: [
            {
              traceId: "0af7651916cd43dd8448eb211c80319c",
              spanId: "b7ad6b7169203331",
              name: "chat gpt-5",
              startTimeUnixNano: NOW_NS,
              endTimeUnixNano: LATER_NS,
              attributes: [
                { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
                { key: "gen_ai.provider.name", value: { stringValue: "openai" } },
                { key: "gen_ai.request.model", value: { stringValue: "gpt-5" } },
                { key: "gen_ai.usage.input_tokens", value: { intValue: "150" } },
                { key: "gen_ai.usage.output_tokens", value: { intValue: 30 } },
                { key: "gen_ai.conversation.id", value: { stringValue: "conv-1" } },
              ],
              status: {},
            },
            {
              traceId: "0af7651916cd43dd8448eb211c80319c",
              spanId: "c7ad6b7169203332",
              parentSpanId: "b7ad6b7169203331",
              name: "execute_tool search",
              startTimeUnixNano: NOW_NS,
              endTimeUnixNano: LATER_NS,
              attributes: [
                { key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } },
              ],
              status: { code: 2, message: "tool timeout" },
            },
          ],
        },
      ],
    },
  ],
};

describe("OTLP ingest", () => {
  const post = (bc: ReturnType<typeof makeBc>, path: string, key: string | null, body: unknown) =>
    bc.handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
      })
    );

  it("accepts OTLP JSON at both route shapes, maps gen_ai + resource env", async () => {
    const bc = makeBc();
    const res = await post(bc, "/admin/traces/api/ingest/otel/v1/traces", "sekrit", OTLP_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ partialSuccess: {} });

    const traces = await bc.api.listTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      name: "chat gpt-5",
      environment: "production", // from resource attrs, not the default
      sessionId: "conv-1",
      spanCount: 2,
      errorCount: 1,
      inputTokens: 150,
      outputTokens: 30,
    });

    const spans = await bc.api.getTrace({ id: traces[0]!.traceId });
    const llm = spans.find((s) => s.kind === "llm")!;
    expect(llm).toMatchObject({ model: "gpt-5", provider: "openai" });
    const tool = spans.find((s) => s.kind === "tool")!;
    expect(tool).toMatchObject({ status: "error", error: "tool timeout", parentSpanId: llm.id });
    expect(llm.startTime).toBeGreaterThan(1_700_000_000_000); // ns → ms, not garbage

    expect((await post(bc, "/admin/traces/api/ingest/otel", "wrong!", OTLP_BODY)).status).toBe(401);
  });
});

describe("authorize option", () => {
  it("guards UI/query routes but not ingest", async () => {
    const bc = makeBc({
      authorize: (req: Request) => req.headers.get("x-user") === "admin",
    });

    const ui = await bc.handler(new Request("http://localhost/admin/traces/api/traces"));
    expect(ui.status).toBe(401);

    const ok = await bc.handler(
      new Request("http://localhost/admin/traces/api/traces", { headers: { "x-user": "admin" } })
    );
    expect(ok.status).toBe(200);

    // ingest key still works without passing authorize
    const ingest = await bc.handler(
      new Request("http://localhost/admin/traces/api/ingest/spans", {
        method: "POST",
        headers: { "content-type": "application/json", "x-breadcrumb-key": "sekrit" },
        body: JSON.stringify({ spans: [] }),
      })
    );
    expect(ingest.status).toBe(200);
  });

  it("supports Response verdicts (redirects) and works through toNextHandler", async () => {
    const bc = makeBc({
      authorize: () => Response.redirect("http://localhost/login", 307),
    });
    const { GET } = toNextHandler(bc);
    const res = await GET(new Request("http://localhost/admin/traces"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });
});

describe("claimSweep", () => {
  it("grants one claim per interval", async () => {
    const adapter = sqlite(new Database(":memory:"));
    await adapter.migrate();
    const now = Date.now();
    expect(await adapter.claimSweep(now, 60_000)).toBe(true);
    expect(await adapter.claimSweep(now + 1000, 60_000)).toBe(false);
    expect(await adapter.claimSweep(now + 61_000, 60_000)).toBe(true);
  });
});
