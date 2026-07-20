import type { CostSummary, RunSummary, SessionSummary, SpanRecord } from "./types.js";

// Relative URLs resolve against the injected <base href>, so the same build
// works at any mount path and in `breadcrumb dev`.
async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  sessions: (environment?: string) =>
    get<{ sessions: SessionSummary[] }>(
      `api/sessions${environment ? `?environment=${encodeURIComponent(environment)}` : ""}`
    ).then((r) => r.sessions),
  runs: (sessionKey: string) =>
    get<{ runs: RunSummary[] }>(`api/sessions/${encodeURIComponent(sessionKey)}/runs`).then(
      (r) => r.runs
    ),
  trace: (traceId: string) =>
    get<{ spans: SpanRecord[] }>(`api/traces/${encodeURIComponent(traceId)}`).then((r) => r.spans),
  cost: (days: number, environment?: string) => {
    const q = new URLSearchParams({ days: String(days) });
    if (environment) q.set("environment", environment);
    return get<CostSummary>(`api/cost?${q.toString()}`);
  },
  environments: () =>
    get<{ environments: string[] }>("api/environments").then((r) => r.environments),
};

export const fmtMs = (ms: number | null | undefined): string => {
  if (ms == null) return "–";
  return ms >= 10_000 ? `${(ms / 1000).toFixed(0)}s` : `${ms}ms`;
};

export const fmtTokens = (input: number, output: number): string => {
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  if (input === 0 && output === 0) return "–";
  return `${k(input)}→${k(output)}`;
};

export const fmtCost = (cost: number | null): string =>
  cost == null ? "–" : `$${cost.toFixed(4)}`;

/** Compact money: 2 decimals at/above $1, 4 below, for tiles and totals. */
export const fmtMoney = (n: number | null): string => {
  if (n == null) return "$0";
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
};

export const fmtInt = (n: number): string => n.toLocaleString();

export const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
