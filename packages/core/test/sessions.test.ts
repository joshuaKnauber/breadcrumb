import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { sqlite, postgres } from "../src/adapters/index.js";
import type { DatabaseAdapter, SpanRecord } from "../src/db/types.js";

const now = Date.now();

const span = (over: Partial<SpanRecord>): SpanRecord => ({
  id: crypto.randomUUID(),
  traceId: "t1",
  parentSpanId: null,
  name: "run",
  kind: "span",
  environment: "production",
  status: "ok",
  startTime: now,
  ...over,
});

async function seed(adapter: DatabaseAdapter) {
  await adapter.migrate();
  // session A: two runs (traces), second one failed
  await adapter.insertSpans([
    span({ traceId: "a1", sessionId: "sess-A", userId: "anna", name: "support-reply",
      input: { q: "hallo" }, output: { a: "welt" }, startTime: now - 5000, endTime: now - 3000 }),
    // child spans deliberately lack sessionId/userId — only roots carry them
    // in reality (AI SDK spans never have them), grouping must still work
    span({ traceId: "a1", name: "generate", kind: "llm",
      parentSpanId: "x", inputTokens: 100, outputTokens: 20, cost: 0.002, startTime: now - 4500, endTime: now - 3200 }),
    span({ traceId: "a2", sessionId: "sess-A", userId: "anna", name: "support-reply",
      input: { q: "noch eine frage" }, startTime: now - 2000, endTime: now - 1800 }),
    span({ traceId: "a2", name: "retrieve", kind: "retrieval",
      parentSpanId: "y", status: "error", error: "index down", startTime: now - 1900, endTime: now - 1850 }),
  ]);
  // session-less trace: stands alone as its own session
  await adapter.insertSpans([
    span({ traceId: "b1", name: "nightly-import", input: { batch: 42 }, output: { ok: true },
      startTime: now - 1000, endTime: now - 200, cost: 0.7, inputTokens: 5000, outputTokens: 300 }),
  ]);
}

const adapters = [
  { label: "sqlite", make: () => sqlite(new Database(":memory:")) },
  {
    label: "postgres",
    make: () => {
      const db = new PGlite();
      return postgres({ query: (text, values) => db.query(text, values as never[]) });
    },
  },
];

describe.each(adapters)("sessions ($label)", ({ make }) => {
  it("groups by sessionId with standalone traces as their own sessions", async () => {
    const adapter = make();
    await seed(adapter);

    const sessions = await adapter.listSessions({});
    expect(sessions).toHaveLength(2);

    // ordered by last activity: standalone b1 is newest
    expect(sessions[0]).toMatchObject({
      sessionKey: "b1", sessionId: null, runCount: 1, errorCount: 0,
      inputTokens: 5000, outputTokens: 300,
    });
    expect(sessions[1]).toMatchObject({
      sessionKey: "sess-A", sessionId: "sess-A", userId: "anna",
      runCount: 2, errorCount: 1, failName: "retrieve",
      inputTokens: 100, outputTokens: 20,
    });
  });

  it("lists runs with root payloads and failure info", async () => {
    const adapter = make();
    await seed(adapter);

    const runs = await adapter.listRuns("sess-A");
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      traceId: "a1", name: "support-reply",
      input: { q: "hallo" }, output: { a: "welt" },
      spanCount: 2, errorCount: 0, inputTokens: 100,
    });
    expect(runs[1]).toMatchObject({
      traceId: "a2", errorCount: 1, failName: "retrieve", failError: "index down",
    });

    const standalone = await adapter.listRuns("b1");
    expect(standalone).toHaveLength(1);
    expect(standalone[0]!.input).toEqual({ batch: 42 });
  });
});
