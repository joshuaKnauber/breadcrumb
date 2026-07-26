export type SpanKind =
  | "span"
  | "llm"
  | "tool"
  | "embedding"
  | "retrieval"
  | "agent";

export type SpanStatus = "ok" | "error";

/** The normalized span model — every ingest dialect maps into this. */
export interface SpanRecord {
  id: string;
  traceId: string;
  parentSpanId?: string | null;
  name: string;
  kind: SpanKind;
  environment: string;
  userId?: string | null;
  sessionId?: string | null;
  model?: string | null;
  provider?: string | null;
  /** Total input tokens, INCLUSIVE of cached reads/writes (normalized). */
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Cache-read tokens — a subset of inputTokens, billed at a discount. */
  cachedInputTokens?: number | null;
  /** Cache-write/creation tokens — a subset of inputTokens, billed at a premium. */
  cacheWriteTokens?: number | null;
  /** Reasoning/thinking tokens — a subset of outputTokens. */
  reasoningTokens?: number | null;
  cost?: number | null;
  status: SpanStatus;
  error?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown> | null;
  startTime: number;
  endTime?: number | null;
}

/** Trace list row, aggregated from spans on read. */
export interface TraceSummary {
  traceId: string;
  name: string;
  environment: string;
  userId: string | null;
  sessionId: string | null;
  startTime: number;
  endTime: number | null;
  spanCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

/**
 * Filters shared by list + stats queries. Each dimension selects *traces*
 * (a trace matches if any of its spans satisfies the predicate), so a filtered
 * list still aggregates a trace's full span set — counts and cost stay whole.
 */
export interface TraceFilter {
  environment?: string;
  userId?: string;
  /** "error" → traces with a failed span; "ok" → traces with none. */
  status?: SpanStatus;
  /** Traces containing a span with this exact model. */
  model?: string;
  /** Inclusive lower/upper bounds on span start_time (epoch ms). */
  since?: number;
  until?: number;
}

export interface ListOptions extends TraceFilter {
  /** Page size. Default 50, clamped to 500. */
  limit?: number;
  /** Opaque keyset cursor from a previous page's `nextCursor`. */
  cursor?: string;
}

/** Back-compat alias for the pre-filter options shape. */
export type ListTracesOptions = ListOptions;

/** One page of results plus the cursor to fetch the next (null at the end). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Headline numbers over a filtered set of traces, for a custom dashboard. */
export interface Stats {
  /** Distinct traces (runs) in the set. */
  runs: number;
  /** Runs containing at least one failed span. */
  errors: number;
  /** errors / runs, 0 when empty. */
  errorRate: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  /** Mean/max root-span duration in ms; null when no run has ended. */
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
}

/**
 * A session groups traces sharing a sessionId; traces without one stand
 * alone (sessionKey = traceId), so every trace appears in the sessions view.
 */
export interface SessionSummary {
  sessionKey: string;
  sessionId: string | null;
  userId: string | null;
  environment: string;
  startTime: number;
  endTime: number | null;
  runCount: number;
  errorCount: number;
  failName: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

/** One run = one trace, with its root span's payload for the feed. */
export interface RunSummary {
  traceId: string;
  name: string;
  input: unknown;
  output: unknown;
  startTime: number;
  endTime: number | null;
  spanCount: number;
  errorCount: number;
  failName: string | null;
  failError: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface MigrationResult {
  createdTables: string[];
  addedColumns: string[];
}

export type Dialect = "postgres" | "sqlite";

/** A snapshot of the live schema, from `inspectSchema()`, used to plan a diff. */
export interface SchemaState {
  spansExists: boolean;
  spansColumns: Set<string>;
  indexNames: Set<string>;
  metaExists: boolean;
  mcpKeysExists: boolean;
}

/** The DDL needed to bring a database to the current schema. */
export interface MigrationPlan {
  /** Statements to run, in order, without trailing semicolons. */
  statements: string[];
  createdTables: string[];
  addedColumns: string[];
}

/**
 * One retention rule: delete spans older than `before` (epoch ms).
 * `environment: null` matches every environment NOT covered by another rule.
 */
export interface RetentionRule {
  environment: string | null;
  before: number;
}

export interface CostQueryOptions {
  environment?: string;
  /** Trailing window in days (default 14, max 90). */
  days?: number;
}

/** One day+model cost bucket, for the stacked time series. */
export interface CostDatum {
  day: string;
  model: string | null;
  cost: number;
  inputTokens: number;
  /** Cache-read tokens within inputTokens. */
  cachedInputTokens: number;
  outputTokens: number;
  count: number;
}

export interface CostGroup {
  key: string | null;
  cost: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  count: number;
}

export interface CostSummary {
  windowDays: number;
  totals: { cost: number; inputTokens: number; cachedInputTokens: number; outputTokens: number };
  days: CostDatum[];
  byModel: CostGroup[];
  byFunction: CostGroup[];
}

/**
 * An MCP key as the dashboard sees it. Deliberately excludes `key_hash` — the
 * only place that ever reads it is the resolver, via findMcpKeyByHash.
 */
export interface McpKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface DatabaseAdapter {
  id: Dialect;
  /** Create/upgrade breadcrumb's tables. Additive-only; safe to call repeatedly. */
  migrate(): Promise<MigrationResult>;
  /** Read the live schema, so a migration can be planned without applying it. */
  inspectSchema(): Promise<SchemaState>;
  insertSpans(spans: SpanRecord[]): Promise<void>;
  listTraces(options: ListOptions): Promise<TraceSummary[]>;
  listSessions(options: ListOptions): Promise<SessionSummary[]>;
  listRuns(sessionKey: string): Promise<RunSummary[]>;
  listEnvironments(): Promise<string[]>;
  costSummary(options: CostQueryOptions): Promise<CostSummary>;
  stats(filter: TraceFilter): Promise<Stats>;
  getTraceSpans(traceId: string): Promise<SpanRecord[]>;
  getSpan(id: string): Promise<SpanRecord | null>;
  /** Bounded delete of expired spans; returns rows deleted (may be < the backlog). */
  deleteExpiredSpans(rules: RetentionRule[], limit: number): Promise<number>;
  /**
   * Atomically claim the sweep slot: true if this caller may sweep now
   * (no other instance swept within intervalMs). DB-backed, pool-safe.
   */
  claimSweep(now: number, intervalMs: number): Promise<boolean>;

  // --- MCP keys: bearer tokens that let a coding agent read traces ---
  listMcpKeys(): Promise<McpKeyRecord[]>;
  insertMcpKey(record: McpKeyRecord & { keyHash: string }): Promise<void>;
  findMcpKeyByHash(keyHash: string): Promise<McpKeyRecord | null>;
  /** Returns false when no key had that id (already revoked, or never existed). */
  deleteMcpKey(id: string): Promise<boolean>;
  touchMcpKey(id: string, at: number): Promise<void>;

  /**
   * The underlying driver handle (better-sqlite3 Database, pg.Pool, ...), so
   * features needing direct SQL can reach it. The MCP server hands this to valv,
   * which compiles and runs the agent's queries under its own policy.
   */
  client(): unknown;

  close?(): Promise<void>;
}
