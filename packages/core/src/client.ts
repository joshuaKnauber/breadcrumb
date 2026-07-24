/**
 * @breadcrumb-sh/core/client — a typed, framework-agnostic fetch client for the
 * handler's JSON API. Mirrors `bc.api` so a browser/SPA custom UI gets the same
 * calls without wiring fetch by hand. Build hooks or components on top.
 */
import type {
  CostSummary,
  ListOptions,
  Page,
  RunSummary,
  SessionSummary,
  SpanRecord,
  Stats,
  TraceFilter,
  TraceSummary,
} from "./db/types.js";

// Re-exported so a browser/React consumer gets the full typed contract from
// one import without pulling the Node-oriented main entry.
export type {
  CostSummary,
  CostDatum,
  CostGroup,
  ListOptions,
  Page,
  RunSummary,
  SessionSummary,
  SpanRecord,
  SpanKind,
  SpanStatus,
  Stats,
  TraceFilter,
  TraceSummary,
} from "./db/types.js";

export interface BreadcrumbClientOptions {
  /**
   * Where the handler is mounted, e.g. "/admin/traces". Requests go to
   * `${basePath}/api/...`. Omit to use relative URLs (`api/...`), which resolve
   * against a page's <base href> — the mode the baked-in dashboard uses.
   */
  basePath?: string;
  /** Override fetch (SSR, custom auth). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Headers sent on every request — e.g. an auth token for your gateway. */
  headers?: Record<string, string>;
}

export interface BreadcrumbClient {
  listTraces(options?: ListOptions): Promise<Page<TraceSummary>>;
  listSessions(options?: ListOptions): Promise<Page<SessionSummary>>;
  listRuns(sessionKey: string): Promise<RunSummary[]>;
  getTrace(traceId: string): Promise<SpanRecord[]>;
  getSpan(id: string): Promise<SpanRecord | null>;
  listEnvironments(): Promise<string[]>;
  cost(options?: { days?: number; environment?: string }): Promise<CostSummary>;
  stats(options?: TraceFilter): Promise<Stats>;
}

function joinUrl(basePath: string, path: string): string {
  // No basePath → relative, resolved against the page's <base href>.
  return basePath ? `${basePath.replace(/\/$/, "")}/${path}` : path;
}

function listQuery(options: ListOptions = {}): string {
  const p = new URLSearchParams();
  if (options.environment) p.set("environment", options.environment);
  if (options.userId) p.set("userId", options.userId);
  if (options.model) p.set("model", options.model);
  if (options.status) p.set("status", options.status);
  if (options.since != null) p.set("since", String(options.since));
  if (options.until != null) p.set("until", String(options.until));
  if (options.limit != null) p.set("limit", String(options.limit));
  if (options.cursor) p.set("cursor", options.cursor);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function createBreadcrumbClient(options: BreadcrumbClientOptions = {}): BreadcrumbClient {
  const basePath = options.basePath ?? "";
  const doFetch = options.fetch ?? fetch;
  const headers = options.headers;

  async function get<T>(path: string, on404?: T): Promise<T> {
    const res = await doFetch(joinUrl(basePath, path), headers ? { headers } : undefined);
    if (res.status === 404 && on404 !== undefined) return on404;
    if (!res.ok) throw new Error(`breadcrumb: ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    listTraces: (opts) => get<Page<TraceSummary>>(`api/traces${listQuery(opts)}`),
    listSessions: (opts) => get<Page<SessionSummary>>(`api/sessions${listQuery(opts)}`),
    listRuns: (sessionKey) =>
      get<{ runs: RunSummary[] }>(`api/sessions/${encodeURIComponent(sessionKey)}/runs`).then((r) => r.runs),
    getTrace: (traceId) =>
      get<{ spans: SpanRecord[] }>(`api/traces/${encodeURIComponent(traceId)}`, { spans: [] }).then((r) => r.spans),
    getSpan: (id) =>
      get<{ span: SpanRecord | null }>(`api/spans/${encodeURIComponent(id)}`, { span: null }).then((r) => r.span),
    listEnvironments: () => get<{ environments: string[] }>("api/environments").then((r) => r.environments),
    cost: (opts = {}) => {
      const p = new URLSearchParams();
      if (opts.days != null) p.set("days", String(opts.days));
      if (opts.environment) p.set("environment", opts.environment);
      const q = p.toString();
      return get<CostSummary>(`api/cost${q ? `?${q}` : ""}`);
    },
    stats: (opts) => get<Stats>(`api/stats${listQuery(opts)}`),
  };
}
