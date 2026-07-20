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
  inputTokens?: number | null;
  outputTokens?: number | null;
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

export interface ListTracesOptions {
  limit?: number;
  environment?: string;
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
  outputTokens: number;
  count: number;
}

export interface CostGroup {
  key: string | null;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  count: number;
}

export interface CostSummary {
  windowDays: number;
  totals: { cost: number; inputTokens: number; outputTokens: number };
  days: CostDatum[];
  byModel: CostGroup[];
  byFunction: CostGroup[];
}

export interface DatabaseAdapter {
  id: string;
  /** Create/upgrade breadcrumb's tables. Additive-only; safe to call repeatedly. */
  migrate(): Promise<MigrationResult>;
  insertSpans(spans: SpanRecord[]): Promise<void>;
  listTraces(options: ListTracesOptions): Promise<TraceSummary[]>;
  listSessions(options: ListTracesOptions): Promise<SessionSummary[]>;
  listRuns(sessionKey: string): Promise<RunSummary[]>;
  costSummary(options: CostQueryOptions): Promise<CostSummary>;
  getTraceSpans(traceId: string): Promise<SpanRecord[]>;
  /** Bounded delete of expired spans; returns rows deleted (may be < the backlog). */
  deleteExpiredSpans(rules: RetentionRule[], limit: number): Promise<number>;
  /**
   * Atomically claim the sweep slot: true if this caller may sweep now
   * (no other instance swept within intervalMs). DB-backed, pool-safe.
   */
  claimSweep(now: number, intervalMs: number): Promise<boolean>;
  close?(): Promise<void>;
}
