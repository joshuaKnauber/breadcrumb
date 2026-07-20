import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { breadcrumb } from "../src/index.js";
import { sqlite, postgres } from "../src/adapters/index.js";
import { inferCost } from "../src/pricing.js";
import type { DatabaseAdapter, SpanRecord } from "../src/db/types.js";

const DAY = 86_400_000;
const now = Date.now();

const span = (over: Partial<SpanRecord>): SpanRecord => ({
  id: crypto.randomUUID(),
  traceId: crypto.randomUUID(),
  parentSpanId: null,
  name: "run",
  kind: "span",
  environment: "production",
  status: "ok",
  startTime: now,
  ...over,
});

describe("pricing", () => {
  it("matches the longest model key as a substring", () => {
    // claude-opus (15/75) should win over any shorter key
    expect(inferCost("claude-opus-4-8", 1_000_000, 1_000_000, { "claude-opus": { input: 15, output: 75 }, claude: { input: 1, output: 1 } })).toBe(90);
  });

  it("returns null for unknown models", () => {
    expect(inferCost("some-local-llm", 1000, 1000, { "gpt-5": { input: 1, output: 1 } })).toBeNull();
  });

  it("infers cost on ingest when model + tokens present but cost is not", async () => {
    const bc = breadcrumb({ database: sqlite(new Database(":memory:")), environment: "production" });
    await bc.api.ingestSpans({
      spans: [
        span({ traceId: "t1", name: "gen", kind: "llm", model: "gpt-5", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      ],
    });
    const spans = await bc.api.getTrace({ id: "t1" });
    // gpt-5: 1.25 in + 10 out per 1M
    expect(spans[0]!.cost).toBeCloseTo(11.25);
  });

  it("respects pricing: false and explicit costs", async () => {
    const bc = breadcrumb({ database: sqlite(new Database(":memory:")), pricing: false });
    await bc.api.ingestSpans({
      spans: [
        span({ traceId: "t1", name: "a", kind: "llm", model: "gpt-5", inputTokens: 1000, outputTokens: 1000 }),
        span({ traceId: "t2", name: "b", kind: "llm", model: "gpt-5", inputTokens: 1000, cost: 0.99 }),
      ],
    });
    expect((await bc.api.getTrace({ id: "t1" }))[0]!.cost).toBeNull();
    expect((await bc.api.getTrace({ id: "t2" }))[0]!.cost).toBe(0.99);
  });
});

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

describe.each(adapters)("costSummary ($label)", ({ make }) => {
  async function seed(adapter: DatabaseAdapter) {
    await adapter.migrate();
    await adapter.insertSpans([
      // two runs of "chat", one of "summarize", spread across today and yesterday
      span({ traceId: "c1", name: "chat", startTime: now - 200 }),
      span({ traceId: "c1", name: "gen", kind: "llm", parentSpanId: "c1", model: "gpt-5", cost: 0.02, inputTokens: 1000, outputTokens: 200, startTime: now - 150 }),
      span({ traceId: "c2", name: "chat", startTime: now - DAY }),
      span({ traceId: "c2", name: "gen", kind: "llm", parentSpanId: "c2", model: "claude-sonnet", cost: 0.05, inputTokens: 2000, outputTokens: 400, startTime: now - DAY }),
      span({ traceId: "s1", name: "summarize", startTime: now - 100 }),
      span({ traceId: "s1", name: "gen", kind: "llm", parentSpanId: "s1", model: "gpt-5", cost: 0.10, inputTokens: 5000, outputTokens: 800, startTime: now - 90 }),
      // outside the window — excluded
      span({ traceId: "old", name: "chat", kind: "llm", model: "gpt-5", cost: 99, inputTokens: 1, startTime: now - 40 * DAY }),
    ]);
  }

  it("aggregates totals, by-model, by-function, and daily buckets", async () => {
    const adapter = make();
    await seed(adapter);

    const summary = await adapter.costSummary({ days: 14 });
    expect(summary.totals.cost).toBeCloseTo(0.17); // 0.02 + 0.05 + 0.10
    expect(summary.totals.inputTokens).toBe(8000);

    // by model, sorted desc by cost: gpt-5 (0.12) then claude-sonnet (0.05)
    expect(summary.byModel.map((m) => m.key)).toEqual(["gpt-5", "claude-sonnet"]);
    expect(summary.byModel[0]!.cost).toBeCloseTo(0.12);

    // by function, attributing child cost to root name: summarize (0.10), chat (0.07)
    expect(summary.byFunction.map((f) => f.key)).toEqual(["summarize", "chat"]);
    expect(summary.byFunction.find((f) => f.key === "chat")!.cost).toBeCloseTo(0.07);
    expect(summary.byFunction.find((f) => f.key === "chat")!.count).toBe(2); // two runs

    // daily buckets span at least two distinct days
    const distinctDays = new Set(summary.days.map((d) => d.day));
    expect(distinctDays.size).toBeGreaterThanOrEqual(2);
  });

  it("filters by window and environment", async () => {
    const adapter = make();
    await seed(adapter);
    // 1-day window excludes the yesterday claude run
    const oneDay = await adapter.costSummary({ days: 1 });
    expect(oneDay.byModel.map((m) => m.key)).toEqual(["gpt-5"]);
  });
});
