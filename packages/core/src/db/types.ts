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

export interface DatabaseAdapter {
  id: string;
  /** Create/upgrade breadcrumb's tables. Additive-only; safe to call repeatedly. */
  migrate(): Promise<void>;
  insertSpans(spans: SpanRecord[]): Promise<void>;
  listTraces(options: ListTracesOptions): Promise<TraceSummary[]>;
  getTraceSpans(traceId: string): Promise<SpanRecord[]>;
  close?(): Promise<void>;
}
