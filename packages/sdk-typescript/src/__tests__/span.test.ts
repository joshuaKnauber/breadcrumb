import { describe, it, expect, vi } from "vitest";
import { SpanHandle } from "../span.js";
import type { SpanPayload } from "@breadcrumb/core";

const TRACE_ID = "a".repeat(32);

function makeClient() {
  return { sendTrace: vi.fn(), sendSpan: vi.fn<[SpanPayload], void>() };
}

function makeSpan(client: ReturnType<typeof makeClient>, parentId?: string) {
  return new SpanHandle(client as any, TRACE_ID, { name: "test-span", type: "llm" }, parentId as any);
}

describe("SpanHandle — end()", () => {
  it("sends span with start_time and end_time", () => {
    const client = makeClient();
    const before = Date.now();
    const span = makeSpan(client);
    span.end();
    const payload = client.sendSpan.mock.calls[0][0];
    expect(new Date(payload.start_time).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(payload.end_time).getTime()).toBeGreaterThanOrEqual(new Date(payload.start_time).getTime());
  });

  it("end_time is always >= start_time", () => {
    const client = makeClient();
    const span = makeSpan(client);
    span.end();
    const { start_time, end_time } = client.sendSpan.mock.calls[0][0];
    expect(new Date(end_time).getTime()).toBeGreaterThanOrEqual(new Date(start_time).getTime());
  });

  it("is idempotent — second call is a no-op", () => {
    const client = makeClient();
    const span = makeSpan(client);
    span.end();
    span.end();
    expect(client.sendSpan).toHaveBeenCalledOnce();
  });

  it("sends trace_id and span id", () => {
    const client = makeClient();
    const span = makeSpan(client);
    span.end();
    const payload = client.sendSpan.mock.calls[0][0];
    expect(payload.trace_id).toBe(TRACE_ID);
    expect(payload.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("passes LLM fields through on end()", () => {
    const client = makeClient();
    const span = makeSpan(client);
    span.end({
      model: "claude-opus-4-6",
      provider: "anthropic",
      inputTokens: 100,
      outputTokens: 50,
      inputCostUsd: 0.0003,
      outputCostUsd: 0.00075,
      output: { content: "hello" },
    });
    const payload = client.sendSpan.mock.calls[0][0];
    expect(payload.model).toBe("claude-opus-4-6");
    expect(payload.provider).toBe("anthropic");
    expect(payload.input_tokens).toBe(100);
    expect(payload.output_tokens).toBe(50);
    expect(payload.input_cost_usd).toBe(0.0003);
    expect(payload.output_cost_usd).toBe(0.00075);
  });

  it("passes status and statusMessage through on end()", () => {
    const client = makeClient();
    const span = makeSpan(client);
    span.end({ status: "error", statusMessage: "timeout" });
    const payload = client.sendSpan.mock.calls[0][0];
    expect(payload.status).toBe("error");
    expect(payload.status_message).toBe("timeout");
  });

  it("defaults status to 'ok'", () => {
    const client = makeClient();
    const span = makeSpan(client);
    span.end();
    expect(client.sendSpan.mock.calls[0][0].status).toBe("ok");
  });
});

describe("SpanHandle — nesting", () => {
  it("child span has parent_span_id set to parent's id", () => {
    const client = makeClient();
    const parent = makeSpan(client);
    const child = parent.span({ name: "child", type: "tool" });
    child.end();
    const payload = client.sendSpan.mock.calls[0][0];
    expect(payload.parent_span_id).toBe(parent.id);
  });

  it("root span has no parent_span_id", () => {
    const client = makeClient();
    const span = makeSpan(client);
    span.end();
    expect(client.sendSpan.mock.calls[0][0].parent_span_id).toBeUndefined();
  });

  it("grandchild shares the same trace_id as root", () => {
    const client = makeClient();
    const root = makeSpan(client);
    const child = root.span({ name: "child", type: "chain" });
    const grandchild = child.span({ name: "grandchild", type: "llm" });
    grandchild.end();
    expect(client.sendSpan.mock.calls[0][0].trace_id).toBe(TRACE_ID);
  });
});
