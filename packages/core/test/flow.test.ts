import { describe, expect, it } from "vitest";
import {
  displayName,
  flowRows,
  fullRows,
  hotspots,
  selfTime,
} from "../src/kit/tree.js";
import { normalizeSpanData } from "../src/otel/normalize.js";
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

/**
 * A trace shaped the way the AI SDK actually emits one: every model call is
 * wrapped in a pass-through `ai.streamText` span, tool calls arrive as
 * `ai.toolCall`, and a subagent nests its own loop underneath.
 */
const trace: SpanRecord[] = [
  span({ id: "root", name: "support-reply", kind: "agent", startTime: 0, endTime: 6240, status: "error" }),
  span({ id: "ctx", parentSpanId: "root", name: "load-context", kind: "retrieval", startTime: 0, endTime: 210 }),
  span({ id: "bp", parentSpanId: "root", name: "build-prompt", startTime: 212, endTime: 240 }),
  span({ id: "gen", parentSpanId: "root", name: "generate", startTime: 245, endTime: 3980 }),

  span({ id: "st1", parentSpanId: "gen", name: "ai.streamText", startTime: 250, endTime: 1890 }),
  span({ id: "ds1", parentSpanId: "st1", name: "ai.streamText.doStream", kind: "llm",
    startTime: 254, endTime: 1888, model: "gpt-5", inputTokens: 1240, outputTokens: 380, cost: 0.0038 }),

  // normalizeSpanData resolves `ai.toolCall` to the tool's own name on ingest
  span({ id: "tc1", parentSpanId: "gen", name: "lookup-order", kind: "tool",
    startTime: 1900, endTime: 2140 }),

  span({ id: "st2", parentSpanId: "gen", name: "ai.streamText", startTime: 2150, endTime: 3970 }),
  span({ id: "ds2", parentSpanId: "st2", name: "ai.streamText.doStream", kind: "llm",
    startTime: 2154, endTime: 3968, model: "gpt-5", inputTokens: 2180, outputTokens: 512, cost: 0.0071 }),

  span({ id: "sub", parentSpanId: "root", name: "refund-eligibility", kind: "agent",
    startTime: 3990, endTime: 5420 }),
  span({ id: "st3", parentSpanId: "sub", name: "ai.streamText", startTime: 3995, endTime: 4870 }),
  span({ id: "ds3", parentSpanId: "st3", name: "ai.streamText.doStream", kind: "llm",
    startTime: 3998, endTime: 4868, model: "gpt-5-mini", inputTokens: 890, outputTokens: 210, cost: 0.0009 }),

  span({ id: "val", parentSpanId: "root", name: "validate-output", kind: "tool", startTime: 5430, endTime: 5460 }),
  span({ id: "persist", parentSpanId: "root", name: "persist-reply", kind: "tool",
    startTime: 5470, endTime: 6240, status: "error", error: "deadlock detected" }),
];

const ids = (rows: ReturnType<typeof flowRows>) =>
  rows.map((r) => (r.type === "span" ? r.span.id : `minor:${r.spans.map((s) => s.id).join(",")}`));

describe("flowRows", () => {
  it("folds single-child SDK wrappers and promotes the model call", () => {
    expect(ids(flowRows(trace))).toEqual([
      "root",
      "ctx",
      "gen",
      "ds1",
      "tc1",
      "ds2",
      "sub",
      "ds3",
      "val",
      "persist",
      "minor:bp",
    ]);
  });

  it("keeps agents and subagents as grouping spans", () => {
    const rows = flowRows(trace);
    const sub = rows.find((r) => r.type === "span" && r.span.id === "sub");
    const ds3 = rows.find((r) => r.type === "span" && r.span.id === "ds3");
    expect(sub && sub.type === "span" && sub.depth).toBe(1);
    expect(ds3 && ds3.type === "span" && ds3.depth).toBe(2);
  });

  it("never folds a span carrying an error, cost, or tokens", () => {
    const shown = ids(flowRows(trace));
    expect(shown).toContain("persist");
    expect(shown).toContain("ds1");
    expect(shown).toContain("ds2");
  });

  it("tucks trivial leaves into a counted row instead of dropping them", () => {
    const minor = flowRows(trace).find((r) => r.type === "minor");
    expect(minor && minor.type === "minor" && minor.spans.map((s) => s.id)).toEqual(["bp"]);
  });

  it("leaves multi-child containers alone", () => {
    // `generate` has three children, so it is a real grouping span, not plumbing.
    expect(ids(flowRows(trace))).toContain("gen");
  });

  it("shows every span in the full view", () => {
    expect(fullRows(trace)).toHaveLength(trace.length);
  });
});

describe("selfTime", () => {
  it("counts only the gaps a parent did not spend inside its children", () => {
    const kids = trace.filter((s) => s.parentSpanId === "gen");
    // 245..3980 extent, children cover 250..3970 with small gaps between them
    expect(selfTime(trace.find((s) => s.id === "gen")!, kids)).toBe(35);
  });

  it("equals the full extent for a leaf", () => {
    expect(selfTime(trace.find((s) => s.id === "ctx")!, [])).toBe(210);
  });
});

describe("displayName", () => {
  it("strips SDK plumbing from span names", () => {
    expect(displayName(trace.find((s) => s.id === "ds1")!)).toBe("streamText");
  });

  it("leaves an already-resolved tool name alone", () => {
    expect(displayName(trace.find((s) => s.id === "tc1")!)).toBe("lookup-order");
  });
});

describe("hotspots", () => {
  it("finds where it broke, where the time went, and where the money went", () => {
    const spots = hotspots(trace);
    expect(spots.errorId).toBe("persist");
    expect(spots.slowestId).toBe("ds2");
    expect(spots.costliestId).toBe("ds2");
  });
});

describe("normalizeSpanData tool naming", () => {
  const base = {
    traceId: "t1",
    spanId: "s1",
    parentSpanId: "p1",
    startMs: 0,
    endMs: 10,
    error: null,
  };

  it("renames ai.toolCall spans to the tool they ran", () => {
    const span = normalizeSpanData(
      { ...base, name: "ai.toolCall", attributes: { "ai.toolCall.name": "lookup-order" } },
      "production"
    );
    expect(span.name).toBe("lookup-order");
    expect(span.kind).toBe("tool");
  });

  it("accepts the OTel semconv attribute too", () => {
    const span = normalizeSpanData(
      { ...base, name: "execute_tool", attributes: { "gen_ai.tool.name": "check-refund" } },
      "production"
    );
    expect(span.name).toBe("check-refund");
  });

  it("leaves spans without a tool name untouched", () => {
    const span = normalizeSpanData(
      { ...base, name: "ai.streamText.doStream", attributes: {} },
      "production"
    );
    expect(span.name).toBe("ai.streamText.doStream");
  });

  it("names the operation span after functionId wherever it sits", () => {
    const attributes = {
      "ai.operationId": "ai.streamText",
      "ai.telemetry.functionId": "support-reply",
    };
    const root = normalizeSpanData(
      { ...base, parentSpanId: null, name: "ai.streamText", attributes },
      "production"
    );
    // Nested under someone else's span — Sentry, Langfuse, an HTTP middleware.
    const nested = normalizeSpanData({ ...base, name: "ai.streamText", attributes }, "production");
    expect(root.name).toBe("support-reply");
    expect(nested.name).toBe("support-reply");
  });

  it("keeps functionId off the inner model call and the tool spans", () => {
    const doStream = normalizeSpanData(
      {
        ...base,
        name: "ai.streamText.doStream",
        attributes: {
          "ai.operationId": "ai.streamText.doStream",
          "ai.telemetry.functionId": "support-reply",
        },
      },
      "production"
    );
    const tool = normalizeSpanData(
      {
        ...base,
        name: "ai.toolCall",
        attributes: {
          "ai.operationId": "ai.toolCall",
          "ai.telemetry.functionId": "support-reply",
          "ai.toolCall.name": "lookup-order",
        },
      },
      "production"
    );
    expect(doStream.name).toBe("ai.streamText.doStream");
    expect(tool.name).toBe("lookup-order");
    // Named or not, every span of the call keeps the functionId as a dimension.
    expect(doStream.functionId).toBe("support-reply");
    expect(tool.functionId).toBe("support-reply");
  });
});
