import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IngestClient } from "../client.js";
import type { TracePayload, SpanPayload } from "../types.js";

const makeTrace = (overrides: Partial<TracePayload> = {}): TracePayload => ({
  id: "a".repeat(32),
  name: "test-trace",
  start_time: new Date().toISOString(),
  ...overrides,
});

const makeSpan = (overrides: Partial<SpanPayload> = {}): SpanPayload => ({
  id: "b".repeat(16),
  trace_id: "a".repeat(32),
  name: "test-span",
  type: "llm",
  start_time: new Date().toISOString(),
  end_time: new Date().toISOString(),
  ...overrides,
});

const okFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });

beforeEach(() => {
  vi.stubGlobal("fetch", okFetch);
  okFetch.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IngestClient — flush", () => {
  it("sends buffered traces on flush", async () => {
    const client = new IngestClient({ apiKey: "key", flushInterval: 0 });
    client.sendTrace(makeTrace());
    await client.flush();
    const calls = okFetch.mock.calls.filter(([url]: [string]) => url.includes("/v1/traces"));
    expect(calls).toHaveLength(1);
  });

  it("sends each trace as a separate POST (not batched)", async () => {
    const client = new IngestClient({ apiKey: "key", flushInterval: 0 });
    client.sendTrace(makeTrace());
    client.sendTrace(makeTrace({ end_time: new Date().toISOString() }));
    await client.flush();
    const calls = okFetch.mock.calls.filter(([url]: [string]) => url.includes("/v1/traces"));
    expect(calls).toHaveLength(2);
  });

  it("sends all spans in a single batched POST", async () => {
    const client = new IngestClient({ apiKey: "key", flushInterval: 0 });
    client.sendSpan(makeSpan());
    client.sendSpan(makeSpan({ id: "c".repeat(16) }));
    await client.flush();
    const calls = okFetch.mock.calls.filter(([url]: [string]) => url.includes("/v1/spans"));
    expect(calls).toHaveLength(1);
    const body = JSON.parse(okFetch.mock.calls.find(([url]: [string]) => url.includes("/v1/spans"))[1].body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it("concurrent flush calls do not double-send events", async () => {
    const client = new IngestClient({ apiKey: "key", flushInterval: 0 });
    client.sendTrace(makeTrace());
    // Two concurrent flushes — only one should send (buffer is spliced before await)
    await Promise.all([client.flush(), client.flush()]);
    const calls = okFetch.mock.calls.filter(([url]: [string]) => url.includes("/v1/traces"));
    expect(calls).toHaveLength(1);
  });

  it("flush is a no-op when buffers are empty", async () => {
    const client = new IngestClient({ apiKey: "key", flushInterval: 0 });
    await client.flush();
    expect(okFetch).not.toHaveBeenCalled();
  });
});

describe("IngestClient — shutdown", () => {
  it("drains buffer before resolving", async () => {
    const client = new IngestClient({ apiKey: "key", flushInterval: 0 });
    client.sendTrace(makeTrace());
    client.sendSpan(makeSpan());
    await client.shutdown();
    expect(okFetch).toHaveBeenCalled();
  });

  it("does not send anything after shutdown", async () => {
    const client = new IngestClient({ apiKey: "key", flushInterval: 0 });
    await client.shutdown();
    okFetch.mockClear();
    client.sendTrace(makeTrace());
    // Timer is cleared — no more auto-flushing
    await new Promise((r) => setTimeout(r, 50));
    expect(okFetch).not.toHaveBeenCalled();
  });
});

describe("IngestClient — errors", () => {
  it("throws on non-ok response during manual flush", async () => {
    okFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" });
    const client = new IngestClient({ apiKey: "bad", flushInterval: 0 });
    client.sendTrace(makeTrace());
    await expect(client.flush()).rejects.toThrow("401");
  });

  it("calls onError for background flush failures, does not throw", async () => {
    const onError = vi.fn();
    okFetch.mockRejectedValueOnce(new Error("network error"));
    const client = new IngestClient({ apiKey: "key", flushInterval: 10, onError });
    client.sendTrace(makeTrace());
    await new Promise((r) => setTimeout(r, 50));
    await client.shutdown();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("includes the API key in Authorization header", async () => {
    const client = new IngestClient({ apiKey: "bc_live_secret", flushInterval: 0 });
    client.sendTrace(makeTrace());
    await client.flush();
    const headers = okFetch.mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBe("Bearer bc_live_secret");
  });
});
