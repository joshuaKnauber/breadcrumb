import { describe, expect, it } from "vitest";
import {
  defaultCollapsed,
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

  it("renders every subtree when the span above them never arrived", () => {
    // Two AI SDK calls under a parent breadcrumb never received: both are roots.
    const forest = [
      span({ id: "answer", parentSpanId: "elsewhere", name: "answer", startTime: 0, endTime: 100 }),
      span({ id: "answer-llm", parentSpanId: "answer", name: "ai.streamText.doStream", kind: "llm",
        startTime: 5, endTime: 80, cost: 0.01 }),
      span({ id: "title", parentSpanId: "elsewhere", name: "title", startTime: 120, endTime: 200 }),
    ];
    const model = traceModel(forest);
    expect(model.roots.map((s) => s.id)).toEqual(["answer", "title"]);
    expect(model.order).toEqual(["answer", "answer-llm", "title"]);
    expect(model.total).toBe(200); // the whole run, not just the first subtree
  });

  it("indexes children by parent, ignoring parents outside the set", () => {
    const model = traceModel(trace);
    expect(model.childrenById.get("st1")?.map((s) => s.id)).toEqual(["ds1"]);
    expect(model.childrenById.has("ds1")).toBe(false);
  });
});

/** A nested run: the agent delegates to a sub-agent that runs its own steps. */
const nested: SpanRecord[] = [
  span({ id: "root", name: "support-reply", kind: "agent", startTime: 0, endTime: 900 }),
  span({ id: "sub", parentSpanId: "root", name: "research", kind: "agent", startTime: 10, endTime: 600 }),
  span({ id: "s1", parentSpanId: "sub", name: "search", kind: "tool", startTime: 20, endTime: 300, cost: 0.001 }),
  span({ id: "s2", parentSpanId: "sub", name: "rank", kind: "llm", startTime: 310, endTime: 590, cost: 0.002 }),
  span({ id: "reply", parentSpanId: "root", name: "reply", kind: "llm", startTime: 610, endTime: 900, cost: 0.003 }),
];

describe("collapsing", () => {
  it("hides a collapsed row's whole subtree and counts what it hid", () => {
    const model = traceModel(nested, { collapsed: new Set(["sub"]) });
    expect(rowIds(model)).toEqual(["root", "sub", "reply"]);
    // Hidden rows are no longer keyboard stops either.
    expect(model.order).toEqual(["root", "sub", "reply"]);

    const sub = model.rows.find((r) => r.type === "span" && r.span.id === "sub");
    expect(sub).toMatchObject({ collapsed: true, hasChildren: true, hiddenCount: 2 });
  });

  it("marks which rows can be collapsed at all", () => {
    const model = traceModel(nested);
    const flags = model.rows.flatMap((r) => (r.type === "span" ? [[r.span.id, r.hasChildren]] : []));
    expect(flags).toEqual([
      ["root", true],
      ["sub", true],
      ["s1", false],
      ["s2", false],
      ["reply", false],
    ]);
  });

  it("collapses everything below the top level by default", () => {
    const collapsed = defaultCollapsed(nested);
    expect([...collapsed]).toEqual(["sub"]);
    // The root stays open, so a run opens on its top-level steps.
    expect(rowIds(traceModel(nested, { collapsed }))).toEqual(["root", "sub", "reply"]);
  });
});

describe("timelineRows", () => {
  it("orders every step by when it ran, flat", () => {
    const model = traceModel(nested, { mode: "timeline" });
    expect(rowIds(model)).toEqual(["root", "sub", "s1", "s2", "reply"]);
    expect(model.rows.every((r) => r.type === "span" && r.depth === 0)).toBe(true);
  });

  it("interleaves branches that ran at the same time", () => {
    // Two sub-agents running concurrently: a tree would group them by parent.
    const parallel = [
      span({ id: "root", name: "fanout", kind: "agent", startTime: 0, endTime: 400 }),
      span({ id: "a", parentSpanId: "root", name: "a", kind: "agent", startTime: 10, endTime: 300 }),
      span({ id: "b", parentSpanId: "root", name: "b", kind: "agent", startTime: 20, endTime: 380 }),
      span({ id: "a1", parentSpanId: "a", name: "a1", kind: "tool", startTime: 30, endTime: 290, cost: 0.1 }),
      span({ id: "b1", parentSpanId: "b", name: "b1", kind: "tool", startTime: 25, endTime: 370, cost: 0.1 }),
    ];
    expect(rowIds(traceModel(parallel, { mode: "timeline" }))).toEqual([
      "root",
      "a",
      "b",
      "b1",
      "a1",
    ]);
    expect(rowIds(traceModel(parallel, { mode: "full" }))).toEqual(["root", "a", "a1", "b", "b1"]);
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
