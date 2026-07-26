import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { breadcrumb } from "../src/index.js";
import { sqlite, postgres } from "../src/adapters/index.js";
import { encodeCursor } from "../src/db/rows.js";
import type { DatabaseAdapter, SpanRecord } from "../src/db/types.js";

const now = Date.now();
let seq = 0;

const base = (over: Partial<SpanRecord>): SpanRecord => ({
  id: `s${seq++}`,
  traceId: "t",
  parentSpanId: null,
  name: "run",
  kind: "span",
  environment: "production",
  status: "ok",
  startTime: now,
  ...over,
});

/** A realistic 2-span trace: a root plus one llm child, so filters must select
 * the whole trace by a single span yet still aggregate both. */
function trace(
  id: string,
  opts: { user?: string; model?: string; error?: boolean; at?: number; env?: string } = {}
): SpanRecord[] {
  const at = opts.at ?? now;
  return [
    base({ id: `${id}-root`, traceId: id, name: "chat", userId: opts.user ?? null, environment: opts.env ?? "production", startTime: at, endTime: at + 100 }),
    base({
      id: `${id}-llm`, traceId: id, parentSpanId: `${id}-root`, kind: "llm", name: "gen",
      model: opts.model ?? "gpt-5", cost: 0.01, inputTokens: 100, outputTokens: 20,
      status: opts.error ? "error" : "ok", error: opts.error ? "boom" : null,
      startTime: at + 10, endTime: at + 90,
    }),
  ];
}

// t1..t5 oldest→newest, so newest-first order is t5,t4,t3,t2,t1
const SEED = [
  ...trace("t1", { user: "alice", model: "gpt-5", at: now - 5000 }),
  ...trace("t2", { user: "alice", model: "gpt-5", at: now - 4000 }),
  ...trace("t3", { user: "bob", model: "claude-sonnet", at: now - 3000 }),
  ...trace("t4", { user: "bob", model: "claude-sonnet", error: true, at: now - 2000 }),
  ...trace("t5", { user: "carol", model: "gpt-5", at: now - 1000, env: "development" }),
];

const ids = (rows: { traceId: string }[]) => rows.map((r) => r.traceId);

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

describe.each(adapters)("query surface ($label)", ({ make }) => {
  async function seed(): Promise<DatabaseAdapter> {
    const a = make();
    await a.migrate();
    await a.insertSpans(SEED);
    return a;
  }

  it("filters by user, model, status, and environment", async () => {
    const a = await seed();
    expect(ids(await a.listTraces({ userId: "alice" })).sort()).toEqual(["t1", "t2"]);
    expect(ids(await a.listTraces({ model: "claude-sonnet" })).sort()).toEqual(["t3", "t4"]);
    expect(ids(await a.listTraces({ status: "error" }))).toEqual(["t4"]);
    expect(ids(await a.listTraces({ status: "ok" })).sort()).toEqual(["t1", "t2", "t3", "t5"]);
    expect(ids(await a.listTraces({ environment: "development" }))).toEqual(["t5"]);
  });

  it("combines filters and still aggregates each trace's full span set", async () => {
    const a = await seed();
    const rows = await a.listTraces({ userId: "bob", model: "claude-sonnet", status: "error" });
    expect(ids(rows)).toEqual(["t4"]);
    expect(rows[0]!.spanCount).toBe(2); // root + llm, not just the error span
  });

  it("filters by time window", async () => {
    const a = await seed();
    const rows = await a.listTraces({ since: now - 3500, until: now - 1500 });
    expect(ids(rows)).toEqual(["t4", "t3"]);
  });

  it("keyset-paginates newest-first with no gaps or repeats", async () => {
    const a = await seed();
    const p1 = await a.listTraces({ limit: 2 });
    expect(ids(p1)).toEqual(["t5", "t4"]);
    const c1 = encodeCursor(p1[1]!.startTime, p1[1]!.traceId);
    const p2 = await a.listTraces({ limit: 2, cursor: c1 });
    expect(ids(p2)).toEqual(["t3", "t2"]);
    const c2 = encodeCursor(p2[1]!.startTime, p2[1]!.traceId);
    const p3 = await a.listTraces({ limit: 2, cursor: c2 });
    expect(ids(p3)).toEqual(["t1"]);
  });

  it("computes stats over a filter", async () => {
    const a = await seed();
    const s = await a.stats({ userId: "bob" });
    expect(s.runs).toBe(2);
    expect(s.errors).toBe(1);
    expect(s.errorRate).toBe(0.5);
    expect(s.cost).toBeCloseTo(0.02);
    expect(s.inputTokens).toBe(200);
    expect(s.maxLatencyMs).toBe(100); // root span duration
    expect(s.avgLatencyMs).toBe(100);
  });

  it("gets a single span or null", async () => {
    const a = await seed();
    expect((await a.getSpan("t1-llm"))?.model).toBe("gpt-5");
    expect(await a.getSpan("does-not-exist")).toBeNull();
  });
});

describe("bc.api paging", () => {
  it("returns nextCursor until the last, partial page", async () => {
    seq = 0;
    const bc = breadcrumb({ database: sqlite(new Database(":memory:")), environment: "production" });
    await bc.api.ingestSpans({ spans: SEED });

    const p1 = await bc.api.listTraces({ limit: 2 });
    expect(ids(p1.items)).toEqual(["t5", "t4"]);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await bc.api.listTraces({ limit: 2, cursor: p1.nextCursor! });
    expect(ids(p2.items)).toEqual(["t3", "t2"]);

    const p3 = await bc.api.listTraces({ limit: 2, cursor: p2.nextCursor! });
    expect(ids(p3.items)).toEqual(["t1"]);
    expect(p3.nextCursor).toBeNull(); // partial page → end of the set
  });
});
