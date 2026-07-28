import type {
  CostDatum,
  CostGroup,
  CostSummary,
  McpKeyRecord,
  Page,
  RunSummary,
  SessionSummary,
  SpanRecord,
  Stats,
  TraceFilter,
  TraceSummary,
} from "./types.js";

/** Binds a value and returns its SQL placeholder — `?` (sqlite) or `$n` (pg). */
export type Placeholder = (value: unknown) => string;

/** Page size, defaulted and bounded so a caller can't request the whole table. */
export function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 500);
}

/**
 * Trace-selecting predicate for the WHERE clause, ANDing one `trace_id IN (…)`
 * subquery per active filter. Kept as subqueries (not a flat row WHERE) because
 * dimensions live on different spans of a trace — the root carries userId, a
 * child carries model — so a single row rarely satisfies two at once. Returns
 * "" when no filter is set.
 */
export function traceFilterSql(table: string, filter: TraceFilter, ph: Placeholder): string {
  const preds: string[] = [];
  const scope: string[] = [];
  if (filter.environment !== undefined) scope.push(`environment = ${ph(filter.environment)}`);
  if (filter.since !== undefined) scope.push(`start_time >= ${ph(filter.since)}`);
  if (filter.until !== undefined) scope.push(`start_time <= ${ph(filter.until)}`);
  if (scope.length) preds.push(`trace_id IN (SELECT trace_id FROM ${table} WHERE ${scope.join(" AND ")})`);
  if (filter.userId !== undefined) {
    preds.push(`trace_id IN (SELECT trace_id FROM ${table} WHERE user_id = ${ph(filter.userId)})`);
  }
  if (filter.model !== undefined) {
    preds.push(`trace_id IN (SELECT trace_id FROM ${table} WHERE model = ${ph(filter.model)})`);
  }
  if (filter.status === "error") {
    preds.push(`trace_id IN (SELECT trace_id FROM ${table} WHERE status = 'error')`);
  }
  if (filter.status === "ok") {
    preds.push(`trace_id NOT IN (SELECT trace_id FROM ${table} WHERE status = 'error')`);
  }
  return preds.join(" AND ");
}

/**
 * Ranks each span within its trace so `root_rank = 1` marks the run's root.
 *
 * A root is a span with no parent — except the parent may never have reached
 * breadcrumb: another exporter owns it, it was sampled away, or the run is
 * still in flight. Then every span points at a parent that isn't there and a
 * plain `parent_span_id IS NULL` finds no root at all, dropping the run's name
 * and payload. Ordering parentless-first, then earliest-starting, takes the
 * true root when there is one and the topmost surviving span when there isn't.
 */
const ROOT_ORDER =
  "PARTITION BY trace_id ORDER BY CASE WHEN parent_span_id IS NULL THEN 0 ELSE 1 END, start_time, id";

/** The span table with `root_rank` attached, as the aggregations read it. */
function rankedSpans(table: string, whereSql: string): string {
  return `(SELECT *, ROW_NUMBER() OVER (${ROOT_ORDER}) AS root_rank
    FROM ${table} ${whereSql ? `WHERE ${whereSql}` : ""}) s`;
}

/** Keyset predicate for "rows after `cursor`" given a DESC (sortExpr, keyExpr). */
export function keysetSql(sortExpr: string, keyExpr: string, cursor: string, ph: Placeholder): string {
  const c = decodeCursor(cursor);
  if (!c) return "";
  return `(${sortExpr} < ${ph(c.sort)} OR (${sortExpr} = ${ph(c.sort)} AND ${keyExpr} < ${ph(c.key)}))`;
}

const CURSOR_SEP = "|";

export function encodeCursor(sort: number, key: string): string {
  return `${sort}${CURSOR_SEP}${key}`;
}

function decodeCursor(cursor: string): { sort: number; key: string } | null {
  const i = cursor.indexOf(CURSOR_SEP);
  if (i < 0) return null;
  const sort = Number(cursor.slice(0, i));
  const key = cursor.slice(i + 1);
  return Number.isFinite(sort) && key ? { sort, key } : null;
}

/** Wrap a page of rows with its next cursor (null when the page wasn't full). */
export function pageOf<T>(items: T[], limit: number, sortOf: (row: T) => number, keyOf: (row: T) => string): Page<T> {
  const last = items[items.length - 1];
  const nextCursor = items.length >= limit && last ? encodeCursor(sortOf(last), keyOf(last)) : null;
  return { items, nextCursor };
}

/** Span -> DB row. JSON payloads are stringified (works for TEXT and JSONB). */
export function spanToRow(span: SpanRecord): Record<string, unknown> {
  return {
    id: span.id,
    trace_id: span.traceId,
    parent_span_id: span.parentSpanId ?? null,
    name: span.name,
    function_id: span.functionId ?? null,
    kind: span.kind,
    environment: span.environment,
    user_id: span.userId ?? null,
    session_id: span.sessionId ?? null,
    model: span.model ?? null,
    provider: span.provider ?? null,
    input_tokens: span.inputTokens ?? null,
    output_tokens: span.outputTokens ?? null,
    cached_input_tokens: span.cachedInputTokens ?? null,
    cache_write_tokens: span.cacheWriteTokens ?? null,
    reasoning_tokens: span.reasoningTokens ?? null,
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
    functionId: (row.function_id as string | null) ?? null,
    kind: row.kind as SpanRecord["kind"],
    environment: row.environment as string,
    userId: (row.user_id as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    inputTokens: numValue(row.input_tokens),
    outputTokens: numValue(row.output_tokens),
    cachedInputTokens: numValue(row.cached_input_tokens),
    cacheWriteTokens: numValue(row.cache_write_tokens),
    reasoningTokens: numValue(row.reasoning_tokens),
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
 * into sessions; sessionless traces stand alone keyed by trace_id. `whereSql`
 * filters which traces feed the rollup; `havingSql` is the outer keyset.
 * Ordered by last activity (MAX end_time) so the cursor key sits in the row.
 */
export function sessionSummarySelect(table: string, whereSql: string, havingSql: string): string {
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
    ${whereSql ? `WHERE ${whereSql}` : ""}
    GROUP BY trace_id
  ) t
  GROUP BY COALESCE(t.session_id, t.trace_id)
  ${havingSql ? `HAVING ${havingSql}` : ""}
  ORDER BY MAX(t.end_time) DESC, COALESCE(t.session_id, t.trace_id) DESC`;
}

/** Headline stats over the filtered trace set: one row per trace, then rolled up. */
export function statsSelect(table: string, whereSql: string): string {
  return `SELECT
    COUNT(*) AS runs,
    SUM(has_error) AS errors,
    SUM(cost) AS cost,
    SUM(input_tokens) AS input_tokens,
    SUM(output_tokens) AS output_tokens,
    AVG(duration) AS avg_latency,
    MAX(duration) AS max_latency
  FROM (
    SELECT trace_id,
      MAX(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS has_error,
      SUM(COALESCE(cost, 0)) AS cost,
      SUM(COALESCE(input_tokens, 0)) AS input_tokens,
      SUM(COALESCE(output_tokens, 0)) AS output_tokens,
      MAX(end_time) - MIN(start_time) AS duration
    FROM ${table}
    ${whereSql ? `WHERE ${whereSql}` : ""}
    GROUP BY trace_id
  ) t`;
}

export function shapeStats(row: Record<string, unknown> | undefined): Stats {
  const runs = numValue(row?.runs) ?? 0;
  const errors = numValue(row?.errors) ?? 0;
  const avg = numValue(row?.avg_latency);
  return {
    runs,
    errors,
    errorRate: runs > 0 ? errors / runs : 0,
    cost: numValue(row?.cost) ?? 0,
    inputTokens: numValue(row?.input_tokens) ?? 0,
    outputTokens: numValue(row?.output_tokens) ?? 0,
    avgLatencyMs: avg == null ? null : Math.round(avg),
    maxLatencyMs: numValue(row?.max_latency),
  };
}

export function runSummarySelect(table: string, keyFilter: string, castText: string): string {
  return `SELECT
    trace_id,
    MAX(CASE WHEN root_rank = 1 THEN name END) AS name,
    MAX(CASE WHEN root_rank = 1 THEN input${castText} END) AS input,
    MAX(CASE WHEN root_rank = 1 THEN output${castText} END) AS output,
    MIN(start_time) AS start_time,
    MAX(end_time) AS end_time,
    COUNT(*) AS span_count,
    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
    MAX(CASE WHEN status = 'error' THEN name END) AS fail_name,
    MAX(CASE WHEN status = 'error' THEN error END) AS fail_error,
    SUM(COALESCE(input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    SUM(cost) AS cost
  FROM ${rankedSpans(
    table,
    `trace_id IN (
      SELECT trace_id FROM ${table}
      GROUP BY trace_id
      HAVING COALESCE(MAX(session_id), trace_id) = ${keyFilter}
    )`
  )}
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
    SUM(COALESCE(cached_input_tokens, 0)) AS cached_input_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    COUNT(*) AS count
  FROM ${table}
  WHERE cost IS NOT NULL ${filter}
  GROUP BY day, model
  ORDER BY day ASC`;
}

/**
 * Cost attributed to the function that spent it: the caller's functionId, or
 * the run's root-span name for spans that carry none (manual `bc.trace` work,
 * or instrumentation that never named itself). Attributing per span rather than
 * per trace splits a run that calls two functions between them, and survives a
 * root that belongs to some other tracer.
 */
export function costByFunctionSelect(table: string, filter: string): string {
  return `SELECT COALESCE(function_id, root_name) AS key,
    SUM(COALESCE(cost, 0)) AS cost,
    SUM(COALESCE(input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(cached_input_tokens, 0)) AS cached_input_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    COUNT(DISTINCT trace_id) AS count
  FROM (
    SELECT trace_id, function_id, cost, input_tokens, cached_input_tokens, output_tokens,
      FIRST_VALUE(name) OVER (${ROOT_ORDER}) AS root_name
    FROM ${table}
    WHERE 1 = 1 ${filter}
  ) t
  GROUP BY COALESCE(function_id, root_name)
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
    cachedInputTokens: numValue(r.cached_input_tokens) ?? 0,
    outputTokens: numValue(r.output_tokens) ?? 0,
    count: numValue(r.count) ?? 0,
  }));

  const totals = days.reduce(
    (a, d) => ({
      cost: a.cost + d.cost,
      inputTokens: a.inputTokens + d.inputTokens,
      cachedInputTokens: a.cachedInputTokens + d.cachedInputTokens,
      outputTokens: a.outputTokens + d.outputTokens,
    }),
    { cost: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  );

  const modelMap = new Map<string | null, CostGroup>();
  for (const d of days) {
    const g = modelMap.get(d.model) ?? { key: d.model, cost: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, count: 0 };
    g.cost += d.cost;
    g.inputTokens += d.inputTokens;
    g.cachedInputTokens += d.cachedInputTokens;
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
      cachedInputTokens: numValue(r.cached_input_tokens) ?? 0,
      outputTokens: numValue(r.output_tokens) ?? 0,
      count: numValue(r.count) ?? 0,
    }))
    .filter((g) => g.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  return { windowDays, totals, days, byModel, byFunction };
}

/**
 * Shared trace aggregation. `whereSql` selects which traces to include (from
 * traceFilterSql); `havingSql` is the keyset predicate. Adapters append LIMIT.
 */
export function traceSummarySelect(table: string, whereSql: string, havingSql: string): string {
  return `SELECT
    trace_id,
    MAX(CASE WHEN root_rank = 1 THEN name END) AS name,
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
  FROM ${rankedSpans(table, whereSql)}
  GROUP BY trace_id
  ${havingSql ? `HAVING ${havingSql}` : ""}
  ORDER BY MIN(start_time) DESC, trace_id DESC`;
}

/** Raw MCP key row, as both dialects return it. */
export interface McpKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number | string;
  last_used_at: number | string | null;
}

export function rowToMcpKey(row: McpKeyRow): McpKeyRecord {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    // Postgres returns BIGINT as a string to avoid precision loss; SQLite gives
    // a number. Both are epoch ms, so normalize on the way out.
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
  };
}
