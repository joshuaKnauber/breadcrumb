import { describe, it, expect, vi, beforeEach } from "vitest";
import { TraceHandle } from "../trace.js";
import type { TracePayload } from "@breadcrumb/core";

// Minimal mock of IngestClient — we only need sendTrace for TraceHandle tests.
function makeClient() {
  return { sendTrace: vi.fn<[TracePayload], void>(), sendSpan: vi.fn() };
}

describe("TraceHandle — start event", () => {
  it("sends a start event immediately on construction", () => {
    const client = makeClient();
    new TraceHandle(client as any, { name: "my-trace" });
    expect(client.sendTrace).toHaveBeenCalledOnce();
  });

  it("start payload has no end_time", () => {
    const client = makeClient();
    new TraceHandle(client as any, { name: "my-trace" });
    const payload = client.sendTrace.mock.calls[0][0];
    expect(payload.end_time).toBeUndefined();
  });

  it("start payload includes name and start_time", () => {
    const client = makeClient();
    const before = Date.now();
    new TraceHandle(client as any, { name: "my-trace" });
    const payload = client.sendTrace.mock.calls[0][0];
    expect(payload.name).toBe("my-trace");
    expect(new Date(payload.start_time).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("passes through userId, environment, tags", () => {
    const client = makeClient();
    new TraceHandle(client as any, {
      name: "my-trace",
      userId: "user-1",
      environment: "production",
      tags: { version: "2" },
    });
    const payload = client.sendTrace.mock.calls[0][0];
    expect(payload.user_id).toBe("user-1");
    expect(payload.environment).toBe("production");
    expect(payload.tags).toEqual({ version: "2" });
  });
});

describe("TraceHandle — end()", () => {
  it("sends an end event with end_time", () => {
    const client = makeClient();
    const handle = new TraceHandle(client as any, { name: "my-trace" });
    client.sendTrace.mockClear();
    handle.end();
    expect(client.sendTrace).toHaveBeenCalledOnce();
    expect(client.sendTrace.mock.calls[0][0].end_time).toBeDefined();
  });

  it("end_time is always >= start_time", () => {
    const client = makeClient();
    const handle = new TraceHandle(client as any, { name: "my-trace" });
    const startPayload = client.sendTrace.mock.calls[0][0];
    handle.end();
    const endPayload = client.sendTrace.mock.calls[1][0];
    expect(new Date(endPayload.end_time!).getTime())
      .toBeGreaterThanOrEqual(new Date(startPayload.start_time).getTime());
  });

  it("is idempotent — second call is a no-op", () => {
    const client = makeClient();
    const handle = new TraceHandle(client as any, { name: "my-trace" });
    client.sendTrace.mockClear();
    handle.end();
    handle.end();
    expect(client.sendTrace).toHaveBeenCalledOnce();
  });

  it("passes status and output to end payload", () => {
    const client = makeClient();
    const handle = new TraceHandle(client as any, { name: "my-trace" });
    client.sendTrace.mockClear();
    handle.end({ status: "error", statusMessage: "boom", output: { result: 42 } });
    const payload = client.sendTrace.mock.calls[0][0];
    expect(payload.status).toBe("error");
    expect(payload.status_message).toBe("boom");
    expect(payload.output).toEqual({ result: 42 });
  });

  it("defaults status to 'ok'", () => {
    const client = makeClient();
    const handle = new TraceHandle(client as any, { name: "my-trace" });
    client.sendTrace.mockClear();
    handle.end();
    expect(client.sendTrace.mock.calls[0][0].status).toBe("ok");
  });
});

describe("TraceHandle — span()", () => {
  it("returns a SpanHandle with the correct trace ID", () => {
    const client = makeClient();
    const handle = new TraceHandle(client as any, { name: "my-trace" });
    const span = handle.span({ name: "child", type: "llm" });
    // SpanHandle.end() calls sendSpan with trace_id matching the trace
    span.end();
    expect(client.sendSpan.mock.calls[0][0].trace_id).toBe(handle.id);
  });
});
