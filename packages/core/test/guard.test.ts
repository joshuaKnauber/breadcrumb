import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { breadcrumb } from "../src/index.js";
import { sqlite } from "../src/adapters/index.js";

function firstSpan(bc: ReturnType<typeof breadcrumb>) {
  return bc.api.listTraces().then(({ items }) => bc.api.getTrace({ id: items[0]!.traceId })).then((s) => s[0]!);
}

describe("payload guarding", () => {
  it("truncates input/output past maxPayloadChars with a marker", async () => {
    const bc = breadcrumb({
      database: sqlite(new Database(":memory:")),
      environment: "test",
      maxPayloadChars: 50,
    });
    await bc.trace("t", async (t) => {
      t.set({ input: "x".repeat(500), output: "y".repeat(500) });
    });
    await bc.flush();

    const root = await firstSpan(bc);
    expect(String(root.input)).toContain("truncated");
    expect(String(root.input).length).toBeLessThan(120);
    expect(String(root.output)).toContain("truncated");
  });

  it("leaves small payloads untouched", async () => {
    const bc = breadcrumb({ database: sqlite(new Database(":memory:")), environment: "test" });
    await bc.trace("t", async (t) => t.set({ input: { q: "hi" } }));
    await bc.flush();
    expect((await firstSpan(bc)).input).toEqual({ q: "hi" });
  });

  it("runs the redact hook before storage", async () => {
    const bc = breadcrumb({
      database: sqlite(new Database(":memory:")),
      environment: "test",
      redact: (s) => {
        if (typeof s.input === "string") s.input = s.input.replace(/sk-\w+/g, "[redacted]");
      },
    });
    await bc.trace("t", async (t) => t.set({ input: "key is sk-abc123 ok" }));
    await bc.flush();
    expect((await firstSpan(bc)).input).toBe("key is [redacted] ok");
  });
});

describe("flush mode", () => {
  it("exports spans in sync mode", async () => {
    const bc = breadcrumb({
      database: sqlite(new Database(":memory:")),
      environment: "test",
      flushMode: "sync",
    });
    await bc.trace("t", async () => "x");
    await bc.flush();
    expect((await bc.api.listTraces()).items).toHaveLength(1);
  });
});

describe("filter indexes", () => {
  it("creates indexes backing the query-surface filters", async () => {
    const db = new Database(":memory:");
    await sqlite(db).migrate();
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
      (r) => r.name
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "breadcrumb_spans_user_id",
        "breadcrumb_spans_model",
        "breadcrumb_spans_status",
      ])
    );
  });
});
