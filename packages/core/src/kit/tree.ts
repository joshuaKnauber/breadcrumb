import type { SpanRecord } from "../db/types.js";

/**
 * Span tree with consecutive same-name siblings collapsed into groups.
 * Groups are display-only: expanding one reveals every member span.
 */
export type TreeNode =
  | { type: "span"; span: SpanRecord; children: TreeNode[] }
  | { type: "group"; name: string; spans: SpanRecord[]; children: TreeNode[][]; stats: GroupStats };

export interface GroupStats {
  count: number;
  totalMs: number;
  cost: number | null;
  hasError: boolean;
}

const GROUP_THRESHOLD = 4;

export function buildTree(spans: SpanRecord[]): TreeNode[] {
  const byParent = new Map<string | null, SpanRecord[]>();
  const ids = new Set(spans.map((s) => s.id));
  for (const s of spans) {
    // parents outside the fetched set (shouldn't happen) fall back to root
    const key = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : null;
    byParent.get(key)?.push(s) ?? byParent.set(key, [s]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));

  function level(parent: string | null): TreeNode[] {
    const siblings = byParent.get(parent) ?? [];
    const nodes: TreeNode[] = [];
    let i = 0;
    while (i < siblings.length) {
      let j = i;
      while (j < siblings.length && siblings[j]!.name === siblings[i]!.name) j++;
      const streak = siblings.slice(i, j);
      if (streak.length >= GROUP_THRESHOLD) {
        nodes.push({
          type: "group",
          name: streak[0]!.name,
          spans: streak,
          children: streak.map((s) => level(s.id)),
          stats: {
            count: streak.length,
            totalMs: streak.reduce((a, s) => a + ((s.endTime ?? s.startTime) - s.startTime), 0),
            cost: streak.some((s) => s.cost != null)
              ? streak.reduce((a, s) => a + (s.cost ?? 0), 0)
              : null,
            hasError: streak.some((s) => s.status === "error"),
          },
        });
      } else {
        for (const s of streak) nodes.push({ type: "span", span: s, children: level(s.id) });
      }
      i = j;
    }
    return nodes;
  }

  return level(null);
}

/** Path (as key set) to every error span, so failed branches start expanded. */
export function errorPaths(spans: SpanRecord[]): { expandKeys: Set<string>; firstErrorId: string | null } {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const expandKeys = new Set<string>();
  // Prefer the DEEPEST error — the root also errors by propagation, but the
  // leaf is where it actually broke.
  let best: { id: string; depth: number; startTime: number } | null = null;
  for (const s of spans) {
    if (s.status !== "error") continue;
    let depth = 0;
    let cur: SpanRecord | undefined = s;
    while (cur) {
      expandKeys.add(cur.id);
      cur = cur.parentSpanId ? byId.get(cur.parentSpanId) : undefined;
      if (cur) depth++;
    }
    if (!best || depth > best.depth || (depth === best.depth && s.startTime < best.startTime)) {
      best = { id: s.id, depth, startTime: s.startTime };
    }
  }
  return { expandKeys, firstErrorId: best?.id ?? null };
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
