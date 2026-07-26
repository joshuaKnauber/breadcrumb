import type { SpanRecord } from "../db/types.js";
import { flowRows, fullRows, hotspots, selfTime, type Hotspots } from "./tree.js";

/**
 * Everything the waterfall needs to render that isn't markup: the flattened
 * rows, the scales the bars are drawn against, and the run's headline numbers.
 * Pure, so the same model drives the shipped dashboard component and a custom
 * UI built from scratch — both read identical numbers off it.
 */

export type TraceViewMode = "flow" | "full";

export const extent = (span: SpanRecord): number =>
  (span.endTime ?? span.startTime) - span.startTime;

/** A row as it appears on screen, with expanded minor groups already spliced in. */
export type TraceRow =
  | { type: "span"; span: SpanRecord; depth: number; children: SpanRecord[] }
  | { type: "minor"; parentId: string; spans: SpanRecord[]; depth: number; open: boolean };

export interface TraceTotals {
  /** null when no span in the run carried a cost, rather than a misleading 0. */
  cost: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface TraceModel {
  root: SpanRecord | null;
  /** The root's extent, floored at 1 so it is always safe to divide by. */
  total: number;
  /** Biggest self time below the root — the scale heat is measured against. */
  maxSelf: number;
  rows: TraceRow[];
  /** Span ids in visual order: the keyboard walks this. */
  order: string[];
  totals: TraceTotals;
  failed: boolean;
  spots: Hotspots | null;
  byId: Map<string, SpanRecord>;
  childrenById: Map<string, SpanRecord[]>;
}

const NO_OPEN: ReadonlySet<string> = new Set();

export function traceModel(
  spans: SpanRecord[],
  options: { mode?: TraceViewMode; openMinor?: ReadonlySet<string> } = {}
): TraceModel {
  const mode = options.mode ?? "flow";
  const openMinor = options.openMinor ?? NO_OPEN;

  const byId = new Map(spans.map((s) => [s.id, s]));
  const childrenById = new Map<string, SpanRecord[]>();
  for (const s of spans) {
    if (!s.parentSpanId || !byId.has(s.parentSpanId)) continue;
    const siblings = childrenById.get(s.parentSpanId);
    if (siblings) siblings.push(s);
    else childrenById.set(s.parentSpanId, [s]);
  }
  const kidsOf = (id: string): SpanRecord[] => childrenById.get(id) ?? [];

  const root = spans.find((s) => !s.parentSpanId) ?? spans[0] ?? null;
  const total = root ? extent(root) || 1 : 1;
  const spots = spans.length > 0 ? hotspots(spans) : null;

  // The root spans the whole run, so including it would flatten every bar.
  let maxSelf = 0;
  for (const s of spans) {
    if (!s.parentSpanId) continue;
    maxSelf = Math.max(maxSelf, selfTime(s, kidsOf(s.id)));
  }

  const source = spans.length === 0 ? [] : mode === "flow" ? flowRows(spans) : fullRows(spans);
  const rows: TraceRow[] = [];
  const order: string[] = [];
  for (const row of source) {
    if (row.type === "span") {
      rows.push({ type: "span", span: row.span, depth: row.depth, children: row.children });
      order.push(row.span.id);
      continue;
    }
    const open = openMinor.has(row.parentId);
    rows.push({ type: "minor", parentId: row.parentId, spans: row.spans, depth: row.depth, open });
    if (!open) continue;
    for (const s of row.spans) {
      rows.push({ type: "span", span: s, depth: row.depth, children: [] });
      order.push(s.id);
    }
  }

  let cost = 0;
  let hasCost = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let failed = false;
  for (const s of spans) {
    if (s.cost != null) {
      cost += s.cost;
      hasCost = true;
    }
    inputTokens += s.inputTokens ?? 0;
    outputTokens += s.outputTokens ?? 0;
    if (s.status === "error") failed = true;
  }

  return {
    root,
    total,
    maxSelf,
    rows,
    order,
    totals: { cost: hasCost ? cost : null, inputTokens, outputTokens },
    failed,
    spots,
    byId,
    childrenById,
  };
}

/** Open a run on its worst moment rather than on a collapsed root. */
export function defaultSelection(model: TraceModel): string | null {
  return model.spots?.errorId ?? model.spots?.slowestId ?? model.root?.id ?? null;
}

/**
 * j/k walk the visible rows; e/s/c jump to the derived hotspots. Returns null
 * for any other key so the caller knows the event was not handled.
 */
export function keyboardTarget(
  model: TraceModel,
  selectedId: string | null,
  key: string
): string | null {
  const { order, spots } = model;
  const i = order.indexOf(selectedId ?? "");
  switch (key) {
    case "j":
      return order.length ? (order[Math.min(i + 1, order.length - 1)] ?? null) : null;
    case "k":
      return order.length ? (order[Math.max(i - 1, 0)] ?? null) : null;
    case "e":
      return spots?.errorId ?? null;
    case "s":
      return spots?.slowestId ?? null;
    case "c":
      return spots?.costliestId ?? null;
    default:
      return null;
  }
}

export type HeatLevel = "error" | "high" | "medium" | "base";

/**
 * How hot a bar reads. Heat is relative to the biggest self time in this run,
 * so a four-step trace doesn't read as uniformly hot and a fifty-step one
 * doesn't read as uniformly cold. The absolute floor keeps a run where every
 * step is trivial from inventing a hotspot out of the least trivial one.
 */
export function heatLevel(
  span: SpanRecord,
  self: number,
  total: number,
  maxSelf: number
): HeatLevel {
  if (span.status === "error") return "error";
  const ratio = maxSelf > 0 ? self / maxSelf : 0;
  const share = total > 0 ? self / total : 0;
  if (ratio > 0.6 && share > 0.1) return "high";
  if (ratio > 0.25 && share > 0.04) return "medium";
  return "base";
}
