import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { postgres } from "../src/adapters/index.js";
import type { SpanRecord } from "../src/db/types.js";

// PGlite implements the pg query interface, so the adapter's SQL runs
// against a real Postgres engine in-process.
function makeAdapter() {
  const db = new PGlite();
  return postgres({ query: (text, values) => db.query(text, values as never[]) });
}

const span = (over: Partial<SpanRecord>): SpanRecord => ({
  id: crypto.randomUUID(),
  traceId: "t1",
  parentSpanId: null,
  name: "root",
  kind: "span",
  environment: "test",
  status: "ok",
  startTime: 1000,
  ...over,
});

describe("postgres adapter (via pglite)", () => {
  it("migrates, inserts, and aggregates", async () => {
    const adapter = makeAdapter();
    const first = await adapter.migrate();
    expect(first.createdTables).toEqual(["breadcrumb_spans"]);
    const second = await adapter.migrate();
    expect(second).toEqual({ createdTables: [], addedColumns: [] });

    const root = span({ name: "pipeline", userId: "u1", input: { q: "hi" }, endTime: 2000 });
    await adapter.insertSpans([
      root,
      span({
        id: "s2",
        parentSpanId: root.id,
        name: "llm-call",
        kind: "llm",
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 25,
        cost: 0.001,
        startTime: 1100,
        endTime: 1900,
        metadata: { a: 1 },
      }),
      span({ id: "s3", parentSpanId: root.id, name: "boom", status: "error", error: "nope", startTime: 1200 }),
    ]);

    const traces = await adapter.listTraces({});
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      traceId: "t1",
      name: "pipeline",
      userId: "u1",
      spanCount: 3,
      errorCount: 1,
      inputTokens: 100,
      outputTokens: 25,
      startTime: 1000,
      endTime: 2000,
    });
    expect(traces[0]!.cost).toBeCloseTo(0.001);

    const spans = await adapter.getTraceSpans("t1");
    expect(spans).toHaveLength(3);
    const llm = spans.find((s) => s.kind === "llm")!;
    expect(llm).toMatchObject({ model: "gpt-5", inputTokens: 100, metadata: { a: 1 } });
    expect(spans.find((s) => s.parentSpanId === null)!.input).toEqual({ q: "hi" });

    // upsert: reinserting the same id replaces, not duplicates
    await adapter.insertSpans([{ ...root, name: "pipeline-renamed" }]);
    expect((await adapter.getTraceSpans("t1")).filter((s) => s.id === root.id)).toHaveLength(1);

    expect(await adapter.listTraces({ environment: "other" })).toHaveLength(0);
  });
});
