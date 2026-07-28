import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { breadcrumb } from "../src/index.js";
import { sqlite, postgres } from "../src/adapters/index.js";
import { computeCost } from "../src/pricing.js";
import { normalizeSpanData } from "../src/otel/normalize.js";
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
    expect(
      computeCost(
        "claude-opus-4-8",
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        { "claude-opus": { input: 15, output: 75 }, claude: { input: 1, output: 1 } }
      )
    ).toBe(90);
  });

  it("returns null for unknown models", () => {
    expect(
      computeCost("some-local-llm", { inputTokens: 1000, outputTokens: 1000 }, { "gpt-5": { input: 1, output: 1 } })
    ).toBeNull();
  });

  it("prices cache-read and cache-write tiers separately, non-cached at base", () => {
    // input 1000 = 700 non-cached + 200 read + 100 write; output 500
    const cost = computeCost(
      "gpt-5",
      { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 200, cacheWriteTokens: 100 },
      { "gpt-5": { input: 10, output: 30, cachedInput: 1, cacheWrite: 12.5 } }
    );
    expect(cost).toBeCloseTo((700 * 10 + 200 * 1 + 100 * 12.5 + 500 * 30) / 1e6);
  });

  it("falls back to base input price when no cache price is declared", () => {
    const cost = computeCost(
      "gpt-5",
      { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 800 },
      { "gpt-5": { input: 10, output: 30 } }
    );
    expect(cost).toBeCloseTo((1000 * 10) / 1e6); // cached charged at base, no invented discount
  });

  it("computes cost from the app-declared price table when cost is not set", async () => {
    const bc = breadcrumb({
      database: sqlite(new Database(":memory:")),
      environment: "production",
      pricing: { "gpt-5": { input: 1.25, output: 10 } },
    });
    await bc.api.ingestSpans({
      spans: [
        span({ traceId: "t1", name: "gen", kind: "llm", model: "gpt-5", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      ],
    });
    const spans = await bc.api.getTrace({ id: "t1" });
    // gpt-5: 1.25 in + 10 out per 1M
    expect(spans[0]!.cost).toBeCloseTo(11.25);
  });

  it("assumes no prices by default — cost stays null unless set explicitly", async () => {
    const bc = breadcrumb({ database: sqlite(new Database(":memory:")) });
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

function otelSpan(attributes: Record<string, unknown>) {
  return {
    traceId: "t",
    spanId: crypto.randomUUID(),
    parentSpanId: "parent",
    name: "chat",
    attributes,
    startMs: now,
    endMs: now + 100,
    error: null,
  };
}

describe("cached-token normalization (input always cache-inclusive)", () => {
  it("keeps ai.* cachedInputTokens as a subset for OpenAI", () => {
    const s = normalizeSpanData(
      otelSpan({
        "ai.model.provider": "openai",
        "ai.model.id": "gpt-5",
        "ai.usage.inputTokens": 1000, // already inclusive
        "ai.usage.outputTokens": 200,
        "ai.usage.cachedInputTokens": 800,
      }),
      "test"
    );
    expect(s.inputTokens).toBe(1000);
    expect(s.cachedInputTokens).toBe(800);
  });

  it("treats ai.* inputTokens as cache-inclusive (v6 convention)", () => {
    const s = normalizeSpanData(
      otelSpan({
        "ai.model.provider": "anthropic",
        "ai.model.id": "claude-sonnet-5",
        "ai.usage.inputTokens": 1000, // already inclusive
        "ai.usage.outputTokens": 120,
        "ai.usage.cachedInputTokens": 900,
      }),
      "test"
    );
    expect(s.inputTokens).toBe(1000);
    expect(s.cachedInputTokens).toBe(900);
  });

  it("treats gen_ai cache attributes as subsets of input_tokens (semconv)", () => {
    const s = normalizeSpanData(
      otelSpan({
        "gen_ai.provider.name": "anthropic",
        "gen_ai.request.model": "claude-opus",
        "gen_ai.usage.input_tokens": 980, // spec: inclusive of cache read/write
        "gen_ai.usage.output_tokens": 120,
        "gen_ai.usage.cache_read.input_tokens": 900,
        "gen_ai.usage.cache_creation.input_tokens": 30,
      }),
      "test"
    );
    expect(s.inputTokens).toBe(980);
    expect(s.cachedInputTokens).toBe(900);
    expect(s.cacheWriteTokens).toBe(30);
  });

  it("clamps input up for emitters reporting cache-exclusive input_tokens", () => {
    // Older Anthropic-style instrumentations: input_tokens excludes cache.
    const s = normalizeSpanData(
      otelSpan({
        "gen_ai.request.model": "claude-opus",
        "gen_ai.usage.input_tokens": 50,
        "gen_ai.usage.output_tokens": 120,
        "gen_ai.usage.cache_read.input_tokens": 900,
        "gen_ai.usage.cache_creation.input_tokens": 30,
      }),
      "test"
    );
    expect(s.inputTokens).toBe(930); // raised to the subset sum, best effort
  });

  it("captures reasoning tokens from both dialects as a subset of output", () => {
    const ai = normalizeSpanData(
      otelSpan({ "ai.model.id": "gpt-5", "ai.usage.inputTokens": 100, "ai.usage.outputTokens": 400, "ai.usage.reasoningTokens": 300 }),
      "test"
    );
    expect(ai.reasoningTokens).toBe(300);
    expect(ai.outputTokens).toBe(400);

    const ga = normalizeSpanData(
      otelSpan({ "gen_ai.request.model": "gpt-5", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 400, "gen_ai.usage.reasoning.output_tokens": 300 }),
      "test"
    );
    expect(ga.reasoningTokens).toBe(300);
  });
});

describe("AI SDK usage carriers (usage counted exactly once per call)", () => {
  it("counts the doGenerate model-call span, not the wrapper's mirror copy", () => {
    const inner = normalizeSpanData(
      otelSpan({
        "ai.operationId": "ai.generateText.doGenerate",
        "ai.model.id": "gpt-5",
        "ai.usage.promptTokens": 1000,
        "ai.usage.completionTokens": 200,
        "gen_ai.usage.input_tokens": 1000,
        "gen_ai.usage.output_tokens": 200,
      }),
      "test"
    );
    expect(inner).toMatchObject({ inputTokens: 1000, outputTokens: 200 });

    // Wrapper spans mirror last-step/aggregate usage — never counted.
    const outer = normalizeSpanData(
      otelSpan({
        "ai.operationId": "ai.generateText",
        "ai.model.id": "gpt-5",
        "ai.usage.promptTokens": 1000,
        "ai.usage.completionTokens": 200,
      }),
      "test"
    );
    expect(outer.inputTokens).toBeNull();
    expect(outer.outputTokens).toBeNull();
  });

  it("takes cache and reasoning detail from doStream spans", () => {
    const doStream = normalizeSpanData(
      otelSpan({
        "ai.operationId": "ai.streamText.doStream",
        "ai.model.id": "gpt-5",
        "ai.usage.inputTokens": 500,
        "ai.usage.outputTokens": 100,
        "ai.usage.cachedInputTokens": 200,
        "ai.usage.reasoningTokens": 30,
      }),
      "test"
    );
    expect(doStream).toMatchObject({
      inputTokens: 500,
      cachedInputTokens: 200,
      reasoningTokens: 30,
    });

    // streamText/streamObject roots mirror the aggregate — skipped.
    const streamRoot = normalizeSpanData(
      otelSpan({
        "ai.operationId": "ai.streamText",
        "ai.usage.inputTokens": 500,
        "ai.usage.outputTokens": 100,
        "ai.usage.cachedInputTokens": 200,
      }),
      "test"
    );
    expect(streamRoot.inputTokens).toBeNull();
  });

  it("reads embedding token counts from doEmbed as input tokens", () => {
    const s = normalizeSpanData(
      otelSpan({
        "ai.operationId": "ai.embed.doEmbed",
        "ai.model.id": "text-embedding-3-small",
        "ai.usage.tokens": 640,
      }),
      "test"
    );
    expect(s.inputTokens).toBe(640);
    const outer = normalizeSpanData(
      otelSpan({ "ai.operationId": "ai.embed", "ai.usage.tokens": 640 }),
      "test"
    );
    expect(outer.inputTokens).toBeNull();
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
      span({ traceId: "c1", name: "gen", kind: "llm", parentSpanId: "c1", model: "gpt-5", cost: 0.02, inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200, startTime: now - 150 }),
      span({ traceId: "c2", name: "chat", startTime: now - DAY }),
      span({ traceId: "c2", name: "gen", kind: "llm", parentSpanId: "c2", model: "claude-sonnet", cost: 0.05, inputTokens: 2000, outputTokens: 400, startTime: now - DAY }),
      span({ traceId: "s1", name: "summarize", startTime: now - 100 }),
      span({ traceId: "s1", name: "gen", kind: "llm", parentSpanId: "s1", model: "gpt-5", cost: 0.10, inputTokens: 5000, cachedInputTokens: 3000, outputTokens: 800, startTime: now - 90 }),
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
    expect(summary.totals.cachedInputTokens).toBe(3400); // 400 + 3000

    // by model, sorted desc by cost: gpt-5 (0.12) then claude-sonnet (0.05)
    expect(summary.byModel.map((m) => m.key)).toEqual(["gpt-5", "claude-sonnet"]);
    expect(summary.byModel[0]!.cost).toBeCloseTo(0.12);
    expect(summary.byModel[0]!.cachedInputTokens).toBe(3400);
    expect(summary.byFunction.find((f) => f.key === "chat")!.cachedInputTokens).toBe(400);

    // by function, attributing child cost to root name: summarize (0.10), chat (0.07)
    expect(summary.byFunction.map((f) => f.key)).toEqual(["summarize", "chat"]);
    expect(summary.byFunction.find((f) => f.key === "chat")!.cost).toBeCloseTo(0.07);
    expect(summary.byFunction.find((f) => f.key === "chat")!.count).toBe(2); // two runs

    // daily buckets span at least two distinct days
    const distinctDays = new Set(summary.days.map((d) => d.day));
    expect(distinctDays.size).toBeGreaterThanOrEqual(2);
  });

  it("attributes cost to the caller's functionId, not the root span's name", async () => {
    const adapter = make();
    await adapter.migrate();
    await adapter.insertSpans([
      // A trace rooted in another tracer's span, running two named functions.
      span({ id: "r", traceId: "f1", name: "POST /api/chat", startTime: now - 300 }),
      span({ traceId: "f1", parentSpanId: "r", name: "ai.streamText.doStream", functionId: "answer",
        kind: "llm", model: "gpt-5", cost: 0.03, inputTokens: 1000, outputTokens: 100, startTime: now - 250 }),
      span({ traceId: "f1", parentSpanId: "r", name: "ai.generateText.doGenerate", functionId: "title",
        kind: "llm", model: "gpt-5", cost: 0.01, inputTokens: 200, outputTokens: 20, startTime: now - 200 }),
    ]);

    const summary = await adapter.costSummary({ days: 14 });
    expect(summary.byFunction.map((f) => f.key)).toEqual(["answer", "title"]);
    expect(summary.byFunction[0]!.cost).toBeCloseTo(0.03);
    expect(summary.byFunction[0]!.count).toBe(1); // one run, counted per trace
  });

  it("filters by window and environment", async () => {
    const adapter = make();
    await seed(adapter);
    // 1-day window excludes the yesterday claude run
    const oneDay = await adapter.costSummary({ days: 1 });
    expect(oneDay.byModel.map((m) => m.key)).toEqual(["gpt-5"]);
  });
});
