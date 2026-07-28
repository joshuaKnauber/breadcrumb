import { describe, expect, it } from "vitest";
import { context, trace } from "@opentelemetry/api";
import Database from "better-sqlite3";
import { BasicTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { breadcrumb, type BreadcrumbOptions } from "../src/index.js";
import { sqlite } from "../src/adapters/index.js";

function makeBc(options: Partial<BreadcrumbOptions> = {}) {
  return breadcrumb({
    database: sqlite(new Database(":memory:")),
    environment: "test",
    ...options,
  });
}

/** Stands in for the app's own provider — @vercel/otel, NodeSDK, Sentry. */
function hostProvider(bc: { spanProcessor: SpanProcessor }) {
  return new BasicTracerProvider({ spanProcessors: [bc.spanProcessor] });
}

describe("spanProcessor", () => {
  it("stores model spans from a provider breadcrumb doesn't own", async () => {
    const bc = makeBc();
    const tracer = hostProvider(bc).getTracer("app");

    const wrapper = tracer.startSpan("ai.generateText");
    wrapper.setAttributes({
      "ai.telemetry.functionId": "answer",
      "ai.operationId": "ai.generateText",
    });
    const call = tracer.startSpan(
      "ai.generateText.doGenerate",
      undefined,
      trace.setSpan(context.active(), wrapper)
    );
    call.setAttributes({
      "ai.telemetry.functionId": "answer",
      "ai.operationId": "ai.generateText.doGenerate",
      "ai.model.id": "gpt-5",
      "ai.usage.inputTokens": 100,
      "ai.usage.outputTokens": 20,
    });
    call.end();
    wrapper.end();

    await bc.flush();

    const { items } = await bc.api.listTraces();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "answer", inputTokens: 100, outputTokens: 20 });
  });

  it("drops the surrounding app's spans rather than dumping them into the trace table", async () => {
    const bc = makeBc();
    const tracer = hostProvider(bc).getTracer("app");

    const http = tracer.startSpan("GET /api/chat");
    http.setAttributes({ "http.method": "GET", "http.route": "/api/chat" });
    http.end();

    await bc.flush();

    expect((await bc.api.listTraces()).items).toHaveLength(0);
  });

  it("keeps the app's own spans when shouldExport says so", async () => {
    const bc = makeBc({ shouldExport: () => true });
    const tracer = hostProvider(bc).getTracer("app");

    const http = tracer.startSpan("GET /api/chat");
    http.setAttributes({ "http.method": "GET" });
    http.end();

    await bc.flush();

    const { items } = await bc.api.listTraces();
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("GET /api/chat");
  });

  it("stitches a model span on the host provider under a bc.trace parent", async () => {
    const bc = makeBc();
    const tracer = hostProvider(bc).getTracer("app");

    await bc.trace("support-reply", async () => {
      const span = tracer.startSpan("ai.generateText");
      span.setAttributes({
        "ai.telemetry.functionId": "answer",
        "ai.operationId": "ai.generateText",
      });
      span.end();
    });

    await bc.flush();

    const { items } = await bc.api.listTraces();
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("support-reply");

    const spans = await bc.api.getTrace({ id: items[0]!.traceId });
    expect(spans).toHaveLength(2);
    const root = spans.find((s) => s.parentSpanId === null)!;
    expect(spans.find((s) => s.name === "answer")!.parentSpanId).toBe(root.id);
  });
});
