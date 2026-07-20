import type {
  CostDatum,
  CostGroup,
  CostSummary,
  RunSummary,
  SessionSummary,
  SpanRecord,
  TraceSummary,
} from "./types.js";

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

export function rowToSessionSummary(row: Record<string, unknown>): SessionSummary {
  return {
    sessionKey: row.session_key as string,
    sessionId: (row.session_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    environment: row.environment as string,
    startTime: numValue(row.start_time)!,
    endTime: numValue(row.end_time),
    runCount: numValue(row.run_count) ?? 0,
    errorCount: numValue(row.error_count) ?? 0,
    failName: (row.fail_name as string | null) ?? null,
    inputTokens: numValue(row.input_tokens) ?? 0,
    outputTokens: numValue(row.output_tokens) ?? 0,
    cost: numValue(row.cost),
  };
}

export function rowToRunSummary(row: Record<string, unknown>): RunSummary {
  return {
    traceId: row.trace_id as string,
    name: row.name as string,
    input: jsonValue(row.input) ?? undefined,
    output: jsonValue(row.output) ?? undefined,
    startTime: numValue(row.start_time)!,
    endTime: numValue(row.end_time),
    spanCount: numValue(row.span_count) ?? 0,
    errorCount: numValue(row.error_count) ?? 0,
    failName: (row.fail_name as string | null) ?? null,
    failError: (row.fail_error as string | null) ?? null,
    inputTokens: numValue(row.input_tokens) ?? 0,
    outputTokens: numValue(row.output_tokens) ?? 0,
    cost: numValue(row.cost),
  };
}

/**
 * Session aggregation. A trace's session is derived first (only the root span
 * reliably carries session_id — AI SDK child spans don't), then traces group
 * into sessions; sessionless traces stand alone keyed by trace_id.
 */
export function sessionSummarySelect(table: string, envFilter: string): string {
  return `SELECT
    COALESCE(t.session_id, t.trace_id) AS session_key,
    MAX(t.session_id) AS session_id,
    MAX(t.user_id) AS user_id,
    MIN(t.environment) AS environment,
    MIN(t.start_time) AS start_time,
    MAX(t.end_time) AS end_time,
    COUNT(*) AS run_count,
    SUM(t.error_count) AS error_count,
    MAX(t.fail_name) AS fail_name,
    SUM(t.input_tokens) AS input_tokens,
    SUM(t.output_tokens) AS output_tokens,
    SUM(t.cost) AS cost
  FROM (
    SELECT trace_id,
      MAX(session_id) AS session_id,
      MAX(user_id) AS user_id,
      MIN(environment) AS environment,
      MIN(start_time) AS start_time,
      MAX(COALESCE(end_time, start_time)) AS end_time,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
      MAX(CASE WHEN status = 'error' THEN name END) AS fail_name,
      SUM(COALESCE(input_tokens, 0)) AS input_tokens,
      SUM(COALESCE(output_tokens, 0)) AS output_tokens,
      SUM(cost) AS cost
    FROM ${table}
    ${envFilter}
    GROUP BY trace_id
  ) t
  GROUP BY COALESCE(t.session_id, t.trace_id)
  ORDER BY MAX(t.start_time) DESC`;
}

export function runSummarySelect(table: string, keyFilter: string, castText: string): string {
  return `SELECT
    trace_id,
    COALESCE(MAX(CASE WHEN parent_span_id IS NULL THEN name END), MIN(name)) AS name,
    MAX(CASE WHEN parent_span_id IS NULL THEN input${castText} END) AS input,
    MAX(CASE WHEN parent_span_id IS NULL THEN output${castText} END) AS output,
    MIN(start_time) AS start_time,
    MAX(end_time) AS end_time,
    COUNT(*) AS span_count,
    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
    MAX(CASE WHEN status = 'error' THEN name END) AS fail_name,
    MAX(CASE WHEN status = 'error' THEN error END) AS fail_error,
    SUM(COALESCE(input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    SUM(cost) AS cost
  FROM ${table}
  WHERE trace_id IN (
    SELECT trace_id FROM ${table}
    GROUP BY trace_id
    HAVING COALESCE(MAX(session_id), trace_id) = ${keyFilter}
  )
  GROUP BY trace_id
  ORDER BY MIN(start_time) ASC`;
}

/**
 * Cost time series bucketed by day + model. `dayExpr` is the dialect-specific
 * expression turning start_time (epoch ms) into a UTC 'YYYY-MM-DD' string;
 * `filter` carries the cutoff/environment predicates (leading AND).
 */
export function costByDaySelect(table: string, dayExpr: string, filter: string): string {
  return `SELECT ${dayExpr} AS day, model,
    SUM(cost) AS cost,
    SUM(COALESCE(input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    COUNT(*) AS count
  FROM ${table}
  WHERE cost IS NOT NULL ${filter}
  GROUP BY day, model
  ORDER BY day ASC`;
}

/** Cost attributed to each run's root-span name (the "function"). */
export function costByFunctionSelect(table: string, filter: string): string {
  return `SELECT root_name AS key,
    SUM(cost) AS cost,
    SUM(input_tokens) AS input_tokens,
    SUM(output_tokens) AS output_tokens,
    COUNT(*) AS count
  FROM (
    SELECT trace_id,
      MAX(CASE WHEN parent_span_id IS NULL THEN name END) AS root_name,
      SUM(COALESCE(cost, 0)) AS cost,
      SUM(COALESCE(input_tokens, 0)) AS input_tokens,
      SUM(COALESCE(output_tokens, 0)) AS output_tokens
    FROM ${table}
    WHERE 1 = 1 ${filter}
    GROUP BY trace_id
  ) t
  GROUP BY root_name
  ORDER BY cost DESC`;
}

export function shapeCostSummary(
  windowDays: number,
  dayRows: Record<string, unknown>[],
  funcRows: Record<string, unknown>[]
): CostSummary {
  const days: CostDatum[] = dayRows.map((r) => ({
    day: r.day as string,
    model: (r.model as string | null) ?? null,
    cost: numValue(r.cost) ?? 0,
    inputTokens: numValue(r.input_tokens) ?? 0,
    outputTokens: numValue(r.output_tokens) ?? 0,
    count: numValue(r.count) ?? 0,
  }));

  const totals = days.reduce(
    (a, d) => ({
      cost: a.cost + d.cost,
      inputTokens: a.inputTokens + d.inputTokens,
      outputTokens: a.outputTokens + d.outputTokens,
    }),
    { cost: 0, inputTokens: 0, outputTokens: 0 }
  );

  const modelMap = new Map<string | null, CostGroup>();
  for (const d of days) {
    const g = modelMap.get(d.model) ?? { key: d.model, cost: 0, inputTokens: 0, outputTokens: 0, count: 0 };
    g.cost += d.cost;
    g.inputTokens += d.inputTokens;
    g.outputTokens += d.outputTokens;
    g.count += d.count;
    modelMap.set(d.model, g);
  }
  const byModel = [...modelMap.values()].sort((a, b) => b.cost - a.cost);

  const byFunction: CostGroup[] = funcRows
    .map((r) => ({
      key: (r.key as string | null) ?? null,
      cost: numValue(r.cost) ?? 0,
      inputTokens: numValue(r.input_tokens) ?? 0,
      outputTokens: numValue(r.output_tokens) ?? 0,
      count: numValue(r.count) ?? 0,
    }))
    .filter((g) => g.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  return { windowDays, totals, days, byModel, byFunction };
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
