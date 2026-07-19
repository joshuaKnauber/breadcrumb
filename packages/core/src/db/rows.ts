import type { SpanRecord, TraceSummary } from "./types.js";

/** Span -> DB row. JSON payloads are stringified (works for TEXT and JSONB). */
export function spanToRow(span: SpanRecord): Record<string, unknown> {
  return {
    id: span.id,
    trace_id: span.traceId,
    parent_span_id: span.parentSpanId ?? null,
    name: span.name,
    kind: span.kind,
    environment: span.environment,
    user_id: span.userId ?? null,
    session_id: span.sessionId ?? null,
    model: span.model ?? null,
    provider: span.provider ?? null,
    input_tokens: span.inputTokens ?? null,
    output_tokens: span.outputTokens ?? null,
    cost: span.cost ?? null,
    status: span.status,
    error: span.error ?? null,
    input: span.input === undefined ? null : JSON.stringify(span.input),
    output: span.output === undefined ? null : JSON.stringify(span.output),
    metadata: span.metadata == null ? null : JSON.stringify(span.metadata),
    start_time: span.startTime,
    end_time: span.endTime ?? null,
  };
}

/** TEXT columns hold JSON strings, JSONB comes back pre-parsed — accept both. */
function jsonValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** BIGINT columns come back as strings from node-postgres — coerce. */
function numValue(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rowToSpan(row: Record<string, unknown>): SpanRecord {
  return {
    id: row.id as string,
    traceId: row.trace_id as string,
    parentSpanId: (row.parent_span_id as string | null) ?? null,
    name: row.name as string,
    kind: row.kind as SpanRecord["kind"],
    environment: row.environment as string,
    userId: (row.user_id as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    inputTokens: numValue(row.input_tokens),
    outputTokens: numValue(row.output_tokens),
    cost: numValue(row.cost),
    status: row.status as SpanRecord["status"],
    error: (row.error as string | null) ?? null,
    input: jsonValue(row.input) ?? undefined,
    output: jsonValue(row.output) ?? undefined,
    metadata: jsonValue(row.metadata) as Record<string, unknown> | null,
    startTime: numValue(row.start_time)!,
    endTime: numValue(row.end_time),
  };
}

export function rowToTraceSummary(row: Record<string, unknown>): TraceSummary {
  return {
    traceId: row.trace_id as string,
    name: row.name as string,
    environment: row.environment as string,
    userId: (row.user_id as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    startTime: numValue(row.start_time)!,
    endTime: numValue(row.end_time),
    spanCount: numValue(row.span_count) ?? 0,
    errorCount: numValue(row.error_count) ?? 0,
    inputTokens: numValue(row.input_tokens) ?? 0,
    outputTokens: numValue(row.output_tokens) ?? 0,
    cost: numValue(row.cost),
  };
}

/** Shared aggregation SQL; adapters supply placeholder syntax + LIMIT/filter. */
export function traceSummarySelect(table: string, envFilter: string): string {
  return `SELECT
    trace_id,
    COALESCE(MAX(CASE WHEN parent_span_id IS NULL THEN name END), MIN(name)) AS name,
    MIN(environment) AS environment,
    MAX(user_id) AS user_id,
    MAX(session_id) AS session_id,
    MIN(start_time) AS start_time,
    MAX(end_time) AS end_time,
    COUNT(*) AS span_count,
    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
    SUM(COALESCE(input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    SUM(cost) AS cost
  FROM ${table}
  ${envFilter}
  GROUP BY trace_id
  ORDER BY MIN(start_time) DESC`;
}
