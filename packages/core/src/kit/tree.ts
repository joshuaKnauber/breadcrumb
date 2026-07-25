import type { SpanRecord } from "../db/types.js";

/**
 * Time a span spent on its own work: its extent minus whatever its children
 * covered. A parent that only awaits children has near-zero self time, which is
 * what separates "this step was slow" from "this step was waiting".
 */
export function selfIntervals(span: SpanRecord, children: SpanRecord[]): [number, number][] {
  const end = span.endTime ?? span.startTime;
  const gaps: [number, number][] = [];
  let cursor = span.startTime;
  for (const child of [...children].sort((a, b) => a.startTime - b.startTime)) {
    if (child.startTime > cursor) gaps.push([cursor, child.startTime]);
    cursor = Math.max(cursor, child.endTime ?? child.startTime);
  }
  if (cursor < end) gaps.push([cursor, end]);
  return gaps;
}

export function selfTime(span: SpanRecord, children: SpanRecord[]): number {
  return selfIntervals(span, children).reduce((sum, [a, b]) => sum + (b - a), 0);
}

/**
 * Human-facing span name. SDK spans carry their plumbing in the name
 * (`ai.streamText.doStream`); the operation is what the reader cares about.
 */
export function displayName(span: SpanRecord): string {
  return span.name.replace(/^ai\./, "").replace(/\.(doStream|doGenerate|doEmbed)$/, "");
}

/** A row in the denoised flow view: a span, or a tucked-away run of trivia. */
export type FlowRow =
  | { type: "span"; span: SpanRecord; depth: number; children: SpanRecord[] }
  | { type: "minor"; parentId: string; spans: SpanRecord[]; depth: number };

/**
 * Denoised view of a trace. Instrumentation wraps every model call in a
 * pass-through span (`ai.streamText` around `ai.streamText.doStream`), which
 * doubles the tree depth without adding information. Folding those leaves the
 * sequence people actually reason about: model call, tool call, model call,
 * grouped under the agent that ran them.
 *
 * Nothing is discarded — folded spans are reachable via the full tree, and
 * trivial leaves collapse into a counted row rather than disappearing.
 */
export function flowRows(spans: SpanRecord[]): FlowRow[] {
  const ids = new Set(spans.map((s) => s.id));
  const byParent = new Map<string | null, SpanRecord[]>();
  for (const s of spans) {
    const key = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : null;
    byParent.get(key)?.push(s) ?? byParent.set(key, [s]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.startTime - b.startTime);

  const root = (byParent.get(null) ?? [])[0];
  if (!root) return [];
  const total = (root.endTime ?? root.startTime) - root.startTime || 1;

  const kids = (s: SpanRecord) => byParent.get(s.id) ?? [];
  const extent = (s: SpanRecord) => (s.endTime ?? s.startTime) - s.startTime;

  // Errors and anything carrying money or tokens always stay visible.
  const load = (s: SpanRecord) =>
    s.status === "error" || s.cost != null || s.inputTokens != null;

  const isWrapper = (s: SpanRecord): boolean => {
    const children = kids(s);
    if (children.length !== 1 || load(s)) return false;
    return (
      extent(children[0]!) >= extent(s) * 0.95 &&
      selfTime(s, children) < total * 0.02
    );
  };
  const isMinor = (s: SpanRecord): boolean =>
    kids(s).length === 0 && s.kind === "span" && !load(s) && selfTime(s, []) < total * 0.01;

  const out: FlowRow[] = [{ type: "span", span: root, depth: 0, children: kids(root) }];

  const walk = (parent: SpanRecord, depth: number): void => {
    const minor: SpanRecord[] = [];
    for (const child of kids(parent)) {
      let node = child;
      while (isWrapper(node)) node = kids(node)[0]!;
      if (isMinor(node)) {
        minor.push(node);
        continue;
      }
      out.push({ type: "span", span: node, depth, children: kids(node) });
      walk(node, depth + 1);
    }
    if (minor.length > 0) out.push({ type: "minor", parentId: parent.id, spans: minor, depth });
  };
  walk(root, 1);
  return out;
}

/** Flat depth-indexed rows for the unfolded tree, matching flowRows' shape. */
export function fullRows(spans: SpanRecord[]): FlowRow[] {
  const ids = new Set(spans.map((s) => s.id));
  const byParent = new Map<string | null, SpanRecord[]>();
  for (const s of spans) {
    const key = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : null;
    byParent.get(key)?.push(s) ?? byParent.set(key, [s]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.startTime - b.startTime);

  const out: FlowRow[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const s of byParent.get(parent) ?? []) {
      out.push({ type: "span", span: s, depth, children: byParent.get(s.id) ?? [] });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * The three steps worth opening a run on, derived from the spans already
 * loaded: where it broke, where the time went, where the money went.
 */
export interface Hotspots {
  errorId: string | null;
  slowestId: string | null;
  costliestId: string | null;
}

export function hotspots(spans: SpanRecord[]): Hotspots {
  const ids = new Set(spans.map((s) => s.id));
  const byParent = new Map<string | null, SpanRecord[]>();
  for (const s of spans) {
    const key = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : null;
    byParent.get(key)?.push(s) ?? byParent.set(key, [s]);
  }
  const nonRoot = spans.filter((s) => s.parentSpanId && ids.has(s.parentSpanId));

  let slowest: SpanRecord | null = null;
  let slowestMs = -1;
  for (const s of nonRoot) {
    const ms = selfTime(s, byParent.get(s.id) ?? []);
    if (ms > slowestMs) {
      slowestMs = ms;
      slowest = s;
    }
  }
  const costliest = spans
    .filter((s) => s.cost != null)
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0];

  return {
    errorId: deepestError(spans),
    slowestId: slowest?.id ?? null,
    costliestId: costliest?.id ?? null,
  };
}

/**
 * Where it actually broke. A failure propagates up every ancestor, so the root
 * reports `error` too; the deepest failing span is the one worth opening on.
 */
function deepestError(spans: SpanRecord[]): string | null {
  const byId = new Map(spans.map((s) => [s.id, s]));
  let best: { id: string; depth: number; startTime: number } | null = null;
  for (const s of spans) {
    if (s.status !== "error") continue;
    let depth = 0;
    let cur = s.parentSpanId ? byId.get(s.parentSpanId) : undefined;
    while (cur) {
      depth++;
      cur = cur.parentSpanId ? byId.get(cur.parentSpanId) : undefined;
    }
    if (!best || depth > best.depth || (depth === best.depth && s.startTime < best.startTime)) {
      best = { id: s.id, depth, startTime: s.startTime };
    }
  }
  return best?.id ?? null;
}

/** Message-shaped payload detection: renders chat instead of raw JSON. */
export interface ChatMessage {
  role: string;
  text: string;
}

export function asMessages(value: unknown): ChatMessage[] | null {
  const arr = extractMessageArray(value);
  if (!arr) return null;
  const msgs: ChatMessage[] = [];
  for (const m of arr) {
    if (typeof m !== "object" || m === null) return null;
    const role = (m as { role?: unknown }).role;
    if (typeof role !== "string") return null;
    msgs.push({ role, text: contentToText((m as { content?: unknown }).content ?? (m as { text?: unknown }).text) });
  }
  return msgs.length > 0 ? msgs : null;
}

function extractMessageArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as { messages?: unknown; prompt?: unknown };
    if (Array.isArray(obj.messages)) return obj.messages;
    if (Array.isArray(obj.prompt)) return obj.prompt;
  }
  return null;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null) {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (p.type === "tool-call") return `[tool call: ${String(p.toolName ?? "?")}]`;
          if (p.type === "tool-result") return `[tool result: ${String(p.toolName ?? "?")}]`;
        }
        return JSON.stringify(part);
      })
      .join("\n");
  }
  return JSON.stringify(content, null, 1);
}

/** Short single-line preview of an arbitrary payload for feed cards. */
export function preview(value: unknown, max = 140): string {
  if (value === undefined || value === null) return "–";
  const msgs = asMessages(value);
  let text: string;
  if (msgs) text = msgs[msgs.length - 1]!.text;
  else if (typeof value === "string") text = value;
  else text = JSON.stringify(value);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
