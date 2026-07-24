import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { breadcrumb } from "../src/index.js";
import { sqlite } from "../src/adapters/index.js";

function makeBc(options: { ingestKey?: string } = {}) {
  return breadcrumb({
    database: sqlite(new Database(":memory:")),
    basePath: "/admin/traces",
    environment: "test",
    ...(options.ingestKey ? { ingest: { apiKey: options.ingestKey } } : {}),
  });
}

describe("manual tracing", () => {
  it("writes nested spans and aggregates them into a trace", async () => {
    const bc = makeBc();

    const result = await bc.trace("support-reply", { userId: "u1" }, async (t) => {
      await t.span("retrieve", { kind: "retrieval" }, async () => "docs");
      await t.span("generate", { kind: "llm" }, async (s) => {
        s.set({ model: "gpt-5", inputTokens: 120, outputTokens: 40, cost: 0.002 });
        return "answer";
      });
      return "done";
    });

    expect(result).toBe("done");
    await bc.flush();

    const traces = await bc.api.listTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      name: "support-reply",
      environment: "test",
      userId: "u1",
      spanCount: 3,
      errorCount: 0,
      inputTokens: 120,
      outputTokens: 40,
    });

    const spans = await bc.api.getTrace({ id: traces[0]!.traceId });
    expect(spans).toHaveLength(3);
    const root = spans.find((s) => s.parentSpanId === null)!;
    expect(root.name).toBe("support-reply");
    const llm = spans.find((s) => s.kind === "llm")!;
    expect(llm.model).toBe("gpt-5");
    expect(llm.parentSpanId).toBe(root.id);
  });

  it("marks spans failed on throw, rethrows, and still persists the trace", async () => {
    const bc = makeBc();

    await expect(
      bc.trace("failing", async (t) => {
        await t.span("boom", async () => {
          throw new Error("kaputt");
        });
      })
    ).rejects.toThrow("kaputt");
    await bc.flush();

    const traces = await bc.api.listTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]!.errorCount).toBe(2); // child failed, root failed via rethrow
    const spans = await bc.api.getTrace({ id: traces[0]!.traceId });
    expect(spans.find((s) => s.name === "boom")!.error).toBe("kaputt");
  });
});

describe("bc.telemetry (AI SDK dialect)", () => {
  it("normalizes ai.* spans emitted through the returned tracer", async () => {
    const bc = makeBc();
    const settings = bc.telemetry({ functionId: "support-reply", metadata: { userId: "u1" } });
    expect(settings.isEnabled).toBe(true);
    expect(settings.functionId).toBe("support-reply");

    // Simulate what v5 generateText emits: usage on the doGenerate model-call
    // span, and a last-step mirror copy on the outer span (must not be counted).
    await settings.tracer.startActiveSpan(
      "ai.generateText",
      {
        attributes: {
          "ai.operationId": "ai.generateText",
          "ai.telemetry.functionId": "support-reply",
          "ai.telemetry.metadata.userId": "u1",
          "ai.model.id": "gpt-5",
          "ai.model.provider": "openai",
          "ai.prompt": '{"prompt":"hallo"}',
          "ai.response.text": "welt",
          "ai.usage.promptTokens": 120,
          "ai.usage.completionTokens": 40,
        },
      },
      async (outer) => {
        await settings.tracer.startActiveSpan(
          "ai.generateText.doGenerate",
          {
            attributes: {
              "ai.operationId": "ai.generateText.doGenerate",
              "ai.model.id": "gpt-5",
              "ai.model.provider": "openai",
              "ai.usage.promptTokens": 120,
              "ai.usage.completionTokens": 40,
              "gen_ai.usage.input_tokens": 120,
              "gen_ai.usage.output_tokens": 40,
              "ai.response.text": "welt",
            },
          },
          async (inner) => inner.end()
        );
        outer.end();
      }
    );
    await bc.flush();

    const traces = await bc.api.listTraces();
    expect(traces).toHaveLength(1);
    // usage counted once, on the doGenerate span — the outer mirror is skipped
    expect(traces[0]).toMatchObject({
      name: "support-reply",
      userId: "u1",
      spanCount: 2,
      inputTokens: 120,
      outputTokens: 40,
    });

    const spans = await bc.api.getTrace({ id: traces[0]!.traceId });
    const llm = spans.find((s) => s.kind === "llm")!;
    expect(llm).toMatchObject({ model: "gpt-5", provider: "openai", output: "welt", inputTokens: 120 });
    const root = spans.find((s) => s.parentSpanId === null)!;
    expect(root.input).toEqual({ prompt: "hallo" });
    expect(root.inputTokens).toBeNull();
    expect(llm.parentSpanId).toBe(root.id);
  });
});

describe("handler", () => {
  const get = (bc: ReturnType<typeof makeBc>, path: string) =>
    bc.handler(new Request(`http://localhost${path}`));

  it("serves the UI shell and trace queries under the base path", async () => {
    const bc = makeBc();
    await bc.trace("t", async () => "x");
    await bc.flush();

    const html = await get(bc, "/admin/traces");
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('<base href="/admin/traces/"');

    const res = await get(bc, "/admin/traces/api/traces");
    expect(res.status).toBe(200);
    const { traces } = await res.json();
    expect(traces).toHaveLength(1);

    const detail = await get(bc, `/admin/traces/api/traces/${traces[0].traceId}`);
    expect(detail.status).toBe(200);

    expect((await get(bc, "/other")).status).toBe(404);
    expect((await get(bc, "/admin/traces/api/nope")).status).toBe(404);
  });

  it("hides ingest when unconfigured, guards it with the api key otherwise", async () => {
    const post = (bc: ReturnType<typeof makeBc>, headers: Record<string, string>, body: unknown) =>
      bc.handler(
        new Request("http://localhost/admin/traces/api/ingest/spans", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        })
      );

    const noIngest = makeBc();
    expect((await post(noIngest, {}, { spans: [] })).status).toBe(404);

    const bc = makeBc({ ingestKey: "sekrit" });
    expect((await post(bc, {}, { spans: [] })).status).toBe(401);
    expect((await post(bc, { "x-breadcrumb-key": "wrong!" }, { spans: [] })).status).toBe(401);

    const ok = await post(bc, { "x-breadcrumb-key": "sekrit" }, {
      spans: [
        { traceId: "t1", name: "external-call", kind: "llm", startTime: Date.now(), inputTokens: 10 },
        { invalid: true },
      ],
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ingested: 1 });

    const traces = await bc.api.listTraces();
    expect(traces[0]).toMatchObject({ name: "external-call", environment: "test", inputTokens: 10 });
  });
});
