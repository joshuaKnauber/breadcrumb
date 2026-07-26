import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  heatLevel,
  keyboardTarget,
  traceModel,
} from "../src/kit/trace.js";
import { fmtAgo, fmtCompact, fmtTokens } from "../src/kit/format.js";
import type { SpanRecord } from "../src/db/types.js";

const span = (over: Partial<SpanRecord> & { id: string; startTime: number }): SpanRecord => ({
  traceId: "t1",
  parentSpanId: null,
  name: "step",
  kind: "span",
  environment: "production",
  status: "ok",
  ...over,
});

/** Same shape the AI SDK emits: a wrapper span around every model call. */
const trace: SpanRecord[] = [
  span({ id: "root", name: "support-reply", kind: "agent", startTime: 0, endTime: 6000, status: "error" }),
  span({ id: "ctx", parentSpanId: "root", name: "load-context", kind: "retrieval", startTime: 0, endTime: 210 }),
  span({ id: "bp", parentSpanId: "root", name: "build-prompt", startTime: 212, endTime: 240 }),
  span({ id: "st1", parentSpanId: "root", name: "ai.streamText", startTime: 250, endTime: 1890 }),
  span({ id: "ds1", parentSpanId: "st1", name: "ai.streamText.doStream", kind: "llm",
    startTime: 254, endTime: 1888, model: "gpt-5", inputTokens: 1240, outputTokens: 380, cost: 0.0038 }),
  span({ id: "tc1", parentSpanId: "root", name: "lookup-order", kind: "tool", startTime: 1900, endTime: 2140 }),
  span({ id: "persist", parentSpanId: "root", name: "persist-reply", kind: "tool",
    startTime: 5470, endTime: 6000, status: "error", error: "deadlock detected" }),
];

const rowIds = (model: ReturnType<typeof traceModel>) =>
  model.rows.map((r) => (r.type === "span" ? r.span.id : `minor:${r.spans.map((s) => s.id).join(",")}`));

describe("traceModel", () => {
  it("flattens the flow view with minor groups collapsed", () => {
    const model = traceModel(trace);
    expect(rowIds(model)).toEqual(["root", "ctx", "ds1", "tc1", "persist", "minor:bp"]);
    // A collapsed group contributes no keyboard stops.
    expect(model.order).toEqual(["root", "ctx", "ds1", "tc1", "persist"]);
  });

  it("splices an expanded minor group into both rows and keyboard order", () => {
    const model = traceModel(trace, { openMinor: new Set(["root"]) });
    expect(rowIds(model)).toEqual(["root", "ctx", "ds1", "tc1", "persist", "minor:bp", "bp"]);
    expect(model.order).toContain("bp");
  });

  it("shows every span in the full view", () => {
    const model = traceModel(trace, { mode: "full" });
    expect(model.order).toHaveLength(trace.length);
  });

  it("scales heat against the deepest step, never the root", () => {
    const model = traceModel(trace);
    // The root's own extent is 6000; the busiest child is far smaller.
    expect(model.maxSelf).toBeLessThan(2000);
    expect(model.maxSelf).toBe(1634); // ds1: 254..1888 with no children
  });

  it("sums tokens and cost across the run", () => {
    const model = traceModel(trace);
    expect(model.totals).toEqual({ cost: 0.0038, inputTokens: 1240, outputTokens: 380 });
    expect(model.failed).toBe(true);
    expect(model.total).toBe(6000);
  });

  it("reports no cost rather than zero when nothing priced", () => {
    const model = traceModel([span({ id: "a", startTime: 0, endTime: 10 })]);
    expect(model.totals.cost).toBeNull();
    expect(model.failed).toBe(false);
  });

  it("survives an empty trace", () => {
    const model = traceModel([]);
    expect(model.root).toBeNull();
    expect(model.rows).toEqual([]);
    expect(model.total).toBe(1);
  });

  it("indexes children by parent, ignoring parents outside the set", () => {
    const model = traceModel(trace);
    expect(model.childrenById.get("st1")?.map((s) => s.id)).toEqual(["ds1"]);
    expect(model.childrenById.has("ds1")).toBe(false);
  });
});

describe("defaultSelection", () => {
  it("opens on the deepest failure", () => {
    expect(defaultSelection(traceModel(trace))).toBe("persist");
  });

  it("falls back to the slowest step when nothing failed", () => {
    const ok = trace.filter((s) => s.status !== "error").map((s) => ({ ...s, status: "ok" as const }));
    const model = traceModel(ok);
    expect(defaultSelection(model)).toBe(model.spots?.slowestId);
  });

  it("falls back to the root for a single-span trace", () => {
    const model = traceModel([span({ id: "solo", startTime: 0, endTime: 5 })]);
    expect(defaultSelection(model)).toBe("solo");
  });
});

describe("keyboardTarget", () => {
  const model = traceModel(trace);

  it("walks forward and back through the visible rows", () => {
    expect(keyboardTarget(model, "root", "j")).toBe("ctx");
    expect(keyboardTarget(model, "ctx", "k")).toBe("root");
  });

  it("clamps at both ends instead of wrapping", () => {
    expect(keyboardTarget(model, "root", "k")).toBe("root");
    expect(keyboardTarget(model, "persist", "j")).toBe("persist");
  });

  it("jumps to the hotspots", () => {
    expect(keyboardTarget(model, null, "e")).toBe("persist");
    expect(keyboardTarget(model, null, "s")).toBe(model.spots?.slowestId);
    expect(keyboardTarget(model, null, "c")).toBe("ds1");
  });

  it("reports an unhandled key so the caller can ignore the event", () => {
    expect(keyboardTarget(model, "root", "x")).toBeNull();
  });
});

describe("heatLevel", () => {
  const s = span({ id: "x", startTime: 0, endTime: 100 });

  it("reserves error for failure, whatever the timing", () => {
    expect(heatLevel({ ...s, status: "error" }, 0, 1000, 1000)).toBe("error");
  });

  it("marks a step that dominates both the run and its peers", () => {
    expect(heatLevel(s, 800, 1000, 800)).toBe("high");
  });

  it("stays cool when a step leads its peers but not the run", () => {
    // Biggest self time in the trace, yet only 5% of a long run.
    expect(heatLevel(s, 50, 1000, 50)).toBe("medium");
    expect(heatLevel(s, 20, 1000, 20)).toBe("base");
  });

  it("does not invent a hotspot when nothing has self time", () => {
    expect(heatLevel(s, 0, 1000, 0)).toBe("base");
  });
});

describe("formatters", () => {
  it("compacts past a thousand", () => {
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(1240)).toBe("1.2k");
    expect(fmtTokens(1240, 380)).toBe("1.2k→380");
    expect(fmtTokens(0, 0)).toBe("–");
  });

  it("renders relative time against a supplied now", () => {
    const now = 1_000_000_000_000;
    expect(fmtAgo(now - 30_000, now)).toBe("just now");
    expect(fmtAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(fmtAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(fmtAgo(now - 4 * 86_400_000, now)).toBe("4d ago");
  });
});
