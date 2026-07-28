import type { SpanRecord } from "../db/types.js";
import {
  flowRows,
  fullRows,
  hotspots,
  rootSpans,
  selfTime,
  timelineRows,
  traceExtent,
  type FlowRow,
  type Hotspots,
} from "./tree.js";

/**
 * Everything the waterfall needs to render that isn't markup: the flattened
 * rows, the scales the bars are drawn against, and the run's headline numbers.
 * Pure, so the same model drives the shipped dashboard component and a custom
 * UI built from scratch — both read identical numbers off it.
 */

export type TraceViewMode = "flow" | "full" | "timeline";

export const extent = (span: SpanRecord): number =>
  (span.endTime ?? span.startTime) - span.startTime;

/** A row as it appears on screen, with expanded minor groups already spliced in. */
export type TraceRow =
  | {
      type: "span";
      span: SpanRecord;
      depth: number;
      children: SpanRecord[];
      /** Whether this row has rows nested under it — i.e. it can be collapsed. */
      hasChildren: boolean;
      collapsed: boolean;
      /** Rows hidden underneath, at any depth. 0 unless collapsed. */
      hiddenCount: number;
    }
  | { type: "minor"; parentId: string; spans: SpanRecord[]; depth: number; open: boolean };

export interface TraceTotals {
  /** null when no span in the run carried a cost, rather than a misleading 0. */
  cost: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface TraceModel {
  /** The run's first root. A trace whose parent spans never arrived can have
   * several — `roots` holds them all, and every one is rendered. */
  root: SpanRecord | null;
  roots: SpanRecord[];
  /**
   * Wall-clock zero for the run's bars. Not the root's start: an orphan whose
   * parent never arrived can begin before it, and measuring from the root would
   * push that span off the left of the track.
   */
  origin: number;
  /** The run's extent, floored at 1 so it is always safe to divide by. */
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

const ROWS_FOR: Record<TraceViewMode, (spans: SpanRecord[]) => FlowRow[]> = {
  flow: flowRows,
  full: fullRows,
  timeline: timelineRows,
};

/**
 * Ids to collapse when a trace first opens: every row below the top level that
 * has rows under it. A run then reads as its roots and the steps they ran, with
 * depth one click away rather than fifty rows deep on arrival.
 */
export function defaultCollapsed(spans: SpanRecord[], mode: TraceViewMode = "flow"): Set<string> {
  const source = ROWS_FOR[mode](spans);
  const out = new Set<string>();
  for (const [i, row] of source.entries()) {
    if (row.type !== "span" || row.depth < 1) continue;
    const next = source[i + 1];
    if (next !== undefined && next.depth > row.depth) out.add(row.span.id);
  }
  return out;
}

export function traceModel(
  spans: SpanRecord[],
  options: {
    mode?: TraceViewMode;
    openMinor?: ReadonlySet<string>;
    /** Span ids whose descendants are hidden. See `defaultCollapsed`. */
    collapsed?: ReadonlySet<string>;
  } = {}
): TraceModel {
  const mode = options.mode ?? "flow";
  const openMinor = options.openMinor ?? NO_OPEN;
  const collapsed = options.collapsed ?? NO_OPEN;

  const byId = new Map(spans.map((s) => [s.id, s]));
  const childrenById = new Map<string, SpanRecord[]>();
  for (const s of spans) {
    if (!s.parentSpanId || !byId.has(s.parentSpanId)) continue;
    const siblings = childrenById.get(s.parentSpanId);
    if (siblings) siblings.push(s);
    else childrenById.set(s.parentSpanId, [s]);
  }
  const kidsOf = (id: string): SpanRecord[] => childrenById.get(id) ?? [];

  const roots = rootSpans(spans);
  const root = roots[0] ?? null;
  let origin = Infinity;
  for (const s of spans) origin = Math.min(origin, s.startTime);
  if (!Number.isFinite(origin)) origin = 0;
  const total = spans.length > 0 ? traceExtent(spans) : 1;
  const spots = spans.length > 0 ? hotspots(spans) : null;

  // A root spans its whole subtree, so including one would flatten every bar.
  const rootIds = new Set(roots.map((s) => s.id));
  let maxSelf = 0;
  for (const s of spans) {
    if (rootIds.has(s.id)) continue;
    maxSelf = Math.max(maxSelf, selfTime(s, kidsOf(s.id)));
  }

  const source = spans.length === 0 ? [] : ROWS_FOR[mode](spans);

  // Minor groups splice in first, so collapsing sees the same rows the reader
  // does. Collapsing then hides whole subtrees by depth, which works for the
  // folded flow view too, where a row's parent isn't always its span's parent.
  const expanded: TraceRow[] = [];
  for (const row of source) {
    if (row.type === "span") {
      expanded.push({ ...row, hasChildren: false, collapsed: false, hiddenCount: 0 });
      continue;
    }
    const open = openMinor.has(row.parentId);
    expanded.push({ type: "minor", parentId: row.parentId, spans: row.spans, depth: row.depth, open });
    if (!open) continue;
    for (const s of row.spans) {
      expanded.push({
        type: "span",
        span: s,
        depth: row.depth,
        children: [],
        hasChildren: false,
        collapsed: false,
        hiddenCount: 0,
      });
    }
  }

  const rows: TraceRow[] = [];
  const order: string[] = [];
  let hidingUnder: { depth: number; row: Extract<TraceRow, { type: "span" }> } | null = null;
  for (const [i, row] of expanded.entries()) {
    if (hidingUnder && row.depth > hidingUnder.depth) {
      hidingUnder.row.hiddenCount++;
      continue;
    }
    hidingUnder = null;
    if (row.type === "minor") {
      rows.push(row);
      continue;
    }
    const next = expanded[i + 1];
    const visible: Extract<TraceRow, { type: "span" }> = {
      ...row,
      hasChildren: next !== undefined && next.depth > row.depth,
    };
    visible.collapsed = visible.hasChildren && collapsed.has(row.span.id);
    rows.push(visible);
    order.push(row.span.id);
    if (visible.collapsed) hidingUnder = { depth: row.depth, row: visible };
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
    roots,
    origin,
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
