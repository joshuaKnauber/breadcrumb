import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { sqlite, postgres } from "../src/adapters/index.js";
import { parseDuration } from "../src/retention.js";
import { breadcrumb } from "../src/index.js";
import type { DatabaseAdapter, SpanRecord } from "../src/db/types.js";

const DAY = 86_400_000;
const now = Date.now();

const span = (over: Partial<SpanRecord>): SpanRecord => ({
  id: crypto.randomUUID(),
  traceId: crypto.randomUUID(),
  parentSpanId: null,
  name: "s",
  kind: "span",
  environment: "production",
  status: "ok",
  startTime: now,
  ...over,
});

function seed(adapter: DatabaseAdapter) {
  return adapter.insertSpans([
    span({ environment: "production", startTime: now - 100 * DAY }), // expired (default 90d)
    span({ environment: "production", startTime: now - 10 * DAY }),  // kept
    span({ environment: "development", startTime: now - 10 * DAY }), // expired (dev 7d)
    span({ environment: "development", startTime: now - 1 * DAY }),  // kept
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

describe.each(adapters)("retention ($label)", ({ make }) => {
  it("applies per-environment windows and the default rule", async () => {
    const adapter = make();
    await adapter.migrate();
    await seed(adapter);

    const deleted = await adapter.deleteExpiredSpans(
      [
        { environment: "development", before: now - 7 * DAY },
        { environment: null, before: now - 90 * DAY },
      ],
      5000
    );
    expect(deleted).toBe(2);

    const remaining = await adapter.listTraces({});
    expect(remaining).toHaveLength(2);
    const envs = remaining.map((t) => t.environment).sort();
    expect(envs).toEqual(["development", "production"]);
  });

  it("respects the batch limit", async () => {
    const adapter = make();
    await adapter.migrate();
    await adapter.insertSpans(
      Array.from({ length: 10 }, () => span({ startTime: now - 100 * DAY }))
    );
    expect(await adapter.deleteExpiredSpans([{ environment: null, before: now - DAY }], 4)).toBe(4);
    expect(await adapter.deleteExpiredSpans([{ environment: null, before: now - DAY }], 100)).toBe(6);
  });
});

describe("bc.api.runRetention", () => {
  it("uses configured windows", async () => {
    const bc = breadcrumb({
      database: sqlite(new Database(":memory:")),
      environment: "production",
      retention: { default: "30d", environments: { staging: "1d" }, sweep: "manual" },
    });
    await bc.api.ingestSpans({
      spans: [
        span({ environment: "production", startTime: now - 40 * DAY }),
        span({ environment: "staging", startTime: now - 2 * DAY }),
        span({ environment: "production", startTime: now - 5 * DAY }),
      ],
    });
    expect(await bc.api.runRetention()).toBe(2);
    expect((await bc.api.listTraces()).items).toHaveLength(1);
  });
});

describe("parseDuration", () => {
  it("parses m/h/d and rejects junk", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("12h")).toBe(12 * 3_600_000);
    expect(parseDuration("90d")).toBe(90 * DAY);
    expect(() => parseDuration("2w")).toThrow();
    expect(() => parseDuration("abc")).toThrow();
  });
});
