import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { clickhouse } from "../db/clickhouse.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Return wall-clock duration in ms, or null if end time is missing/invalid.
function calcDuration(startTime: string, endTime: string | null): number | null {
  if (!endTime) return null;
  const d = new Date(endTime).getTime() - new Date(startTime).getTime();
  return d > 0 ? d : null;
}

// Metadata comes back as a parsed JS object from the ClickHouse JSON client.
// String() would give "[object Object]", so keep it as-is.
function normMetadata(v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v || null; }
  }
  return v; // already an object
}

// COALESCE(trace.end_time, rollup.max_end_time):
// trace.end_time is Nullable — NULL when trace.end() was never called.
// max_end_time is the latest span.end_time from trace_rollups.
// Together they give a real duration for any trace that has at least one span.
const EFFECTIVE_END = `COALESCE(t.end_time, r.max_end_time)`;

const ROLLUPS_JOIN = (projectIdParam: string) => `
  LEFT JOIN (
    SELECT
      trace_id,
      sum(input_tokens)    AS input_tokens,
      sum(output_tokens)   AS output_tokens,
      sum(input_cost_usd)  AS input_cost_usd,
      sum(output_cost_usd) AS output_cost_usd,
      sum(span_count)      AS span_count,
      max(max_end_time)    AS max_end_time
    FROM breadcrumb.trace_rollups
    WHERE project_id = {${projectIdParam}: UUID}
    GROUP BY trace_id
  ) r ON t.id = r.trace_id
`;

// ── Server factory ────────────────────────────────────────────────────────────

export function buildMcpServer(projectId: string): McpServer {
  const server = new McpServer({
    name: "breadcrumb",
    version: "1.0.0",
  });

  // ── get_project_stats ────────────────────────────────────────────
  server.tool(
    "get_project_stats",
    "Get aggregated statistics for the project: total trace count, total cost, and average trace duration.",
    {},
    async () => {
      const result = await clickhouse.query({
        query: `
          SELECT
            count()                AS trace_count,
            sum(r.total_cost_usd)  AS total_cost_usd,
            avgIf(
              toInt64(toUnixTimestamp64Milli(${EFFECTIVE_END})) - toInt64(toUnixTimestamp64Milli(t.start_time)),
              isNotNull(${EFFECTIVE_END}) AND ${EFFECTIVE_END} > t.start_time
            )                      AS avg_duration_ms
          FROM (
            SELECT
              id,
              argMax(start_time, version) AS start_time,
              argMax(end_time, version)   AS end_time
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          ) t
          LEFT JOIN (
            SELECT
              trace_id,
              sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
              max(max_end_time)                      AS max_end_time
            FROM breadcrumb.trace_rollups
            WHERE project_id = {projectId: UUID}
            GROUP BY trace_id
          ) r ON t.id = r.trace_id
        `,
        query_params: { projectId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            traceCount: Number(row["trace_count"] ?? 0),
            totalCostUsd: Number(row["total_cost_usd"] ?? 0) / 1_000_000,
            avgDurationMs: Number(row["avg_duration_ms"] ?? 0),
          }, null, 2),
        }],
      };
    }
  );

  // ── list_traces ──────────────────────────────────────────────────
  server.tool(
    "list_traces",
    "List traces for the project with optional filters. Returns trace metadata including status, cost, tokens, and duration.",
    {
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of traces to return"),
      status: z.enum(["ok", "error"]).optional().describe("Filter by trace status"),
      environment: z.string().optional().describe("Filter by environment (e.g. 'production', 'development')"),
      user_id: z.string().optional().describe("Filter by user ID"),
      date_from: z.string().optional().describe("ISO date string — only return traces after this date"),
      date_to: z.string().optional().describe("ISO date string — only return traces before this date"),
    },
    async ({ limit, status, environment, user_id, date_from, date_to }) => {
      const conditions: string[] = [`project_id = {projectId: UUID}`];
      const params: Record<string, unknown> = { projectId, limit };

      if (status) {
        conditions.push(`status = {status: String}`);
        params["status"] = status;
      }
      if (environment) {
        conditions.push(`environment = {environment: String}`);
        params["environment"] = environment;
      }
      if (user_id) {
        conditions.push(`user_id = {userId: String}`);
        params["userId"] = user_id;
      }
      if (date_from) {
        conditions.push(`start_time >= {dateFrom: DateTime}`);
        params["dateFrom"] = date_from;
      }
      if (date_to) {
        conditions.push(`start_time <= {dateTo: DateTime}`);
        params["dateTo"] = date_to;
      }

      const where = conditions.join(" AND ");

      const result = await clickhouse.query({
        query: `
          SELECT
            t.id,
            t.name,
            t.status,
            t.status_message,
            t.start_time,
            ${EFFECTIVE_END}                                       AS end_time,
            t.user_id,
            t.environment,
            coalesce(r.input_tokens, 0)                        AS input_tokens,
            coalesce(r.output_tokens, 0)                       AS output_tokens,
            coalesce(r.input_cost_usd + r.output_cost_usd, 0)  AS cost_usd,
            coalesce(r.span_count, 0)                          AS span_count
          FROM (
            SELECT
              id,
              argMax(name, version)           AS name,
              argMax(status, version)         AS status,
              argMax(status_message, version) AS status_message,
              argMax(start_time, version)     AS start_time,
              argMax(end_time, version)       AS end_time,
              argMax(user_id, version)        AS user_id,
              argMax(environment, version)    AS environment
            FROM breadcrumb.traces
            WHERE ${where}
            GROUP BY id
          ) t
          ${ROLLUPS_JOIN("projectId")}
          ORDER BY t.start_time DESC
          LIMIT {limit: UInt32}
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const traces = rows.map((r) => {
        const startTime = String(r["start_time"]);
        const endTime = r["end_time"] != null ? String(r["end_time"]) : null;
        return {
          id: String(r["id"]),
          name: String(r["name"]),
          status: String(r["status"]),
          statusMessage: String(r["status_message"] ?? "") || null,
          startTime,
          endTime,
          durationMs: calcDuration(startTime, endTime),
          userId: String(r["user_id"] ?? "") || null,
          environment: String(r["environment"] ?? "") || null,
          inputTokens: Number(r["input_tokens"] ?? 0),
          outputTokens: Number(r["output_tokens"] ?? 0),
          costUsd: Number(r["cost_usd"] ?? 0) / 1_000_000,
          spanCount: Number(r["span_count"] ?? 0),
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(traces, null, 2) }],
      };
    }
  );

  // ── get_trace ────────────────────────────────────────────────────
  server.tool(
    "get_trace",
    "Get a single trace with all its spans, including full input/output text for each span.",
    {
      trace_id: z.string().describe("The trace ID to retrieve"),
    },
    async ({ trace_id }) => {
      const [traceResult, spansResult] = await Promise.all([
        clickhouse.query({
          query: `
            SELECT
              t.id,
              t.name,
              t.status,
              t.status_message,
              t.start_time,
              ${EFFECTIVE_END} AS end_time,
              t.user_id,
              t.environment
            FROM (
              SELECT
                id,
                argMax(name, version)           AS name,
                argMax(status, version)         AS status,
                argMax(status_message, version) AS status_message,
                argMax(start_time, version)     AS start_time,
                argMax(end_time, version)       AS end_time,
                argMax(user_id, version)        AS user_id,
                argMax(environment, version)    AS environment
              FROM breadcrumb.traces
              WHERE project_id = {projectId: UUID}
                AND id = {traceId: String}
              GROUP BY id
            ) t
            LEFT JOIN (
              SELECT
                trace_id,
                max(max_end_time) AS max_end_time
              FROM breadcrumb.trace_rollups
              WHERE project_id = {projectId: UUID}
                AND trace_id = {traceId: String}
              GROUP BY trace_id
            ) r ON t.id = r.trace_id
          `,
          query_params: { projectId, traceId: trace_id },
          format: "JSONEachRow",
        }),
        clickhouse.query({
          query: `
            SELECT
              id,
              parent_span_id,
              name,
              type,
              status,
              status_message,
              start_time,
              end_time,
              provider,
              model,
              input_tokens,
              output_tokens,
              input_cost_usd,
              output_cost_usd,
              input,
              output,
              metadata
            FROM breadcrumb.spans
            WHERE project_id = {projectId: UUID}
              AND trace_id = {traceId: String}
            ORDER BY start_time ASC
          `,
          query_params: { projectId, traceId: trace_id },
          format: "JSONEachRow",
        }),
      ]);

      const traceRows = (await traceResult.json()) as Array<Record<string, unknown>>;
      const spanRows = (await spansResult.json()) as Array<Record<string, unknown>>;

      if (!traceRows.length) {
        return {
          content: [{ type: "text", text: `Trace ${trace_id} not found.` }],
        };
      }

      const tr = traceRows[0];
      const trStartTime = String(tr["start_time"]);
      const trEndTime = tr["end_time"] != null ? String(tr["end_time"]) : null;

      const trace = {
        id: String(tr["id"]),
        name: String(tr["name"]),
        status: String(tr["status"]),
        statusMessage: String(tr["status_message"] ?? "") || null,
        startTime: trStartTime,
        endTime: trEndTime,
        durationMs: calcDuration(trStartTime, trEndTime),
        userId: String(tr["user_id"] ?? "") || null,
        environment: String(tr["environment"] ?? "") || null,
        spans: spanRows.map((r) => {
          const spanStart = String(r["start_time"]);
          const spanEnd = String(r["end_time"]);
          return {
            id: String(r["id"]),
            parentSpanId: String(r["parent_span_id"] ?? "") || null,
            name: String(r["name"]),
            type: String(r["type"]),
            status: String(r["status"]),
            statusMessage: String(r["status_message"] ?? "") || null,
            startTime: spanStart,
            endTime: spanEnd,
            durationMs: calcDuration(spanStart, spanEnd),
            provider: String(r["provider"] ?? "") || null,
            model: String(r["model"] ?? "") || null,
            inputTokens: Number(r["input_tokens"] ?? 0),
            outputTokens: Number(r["output_tokens"] ?? 0),
            inputCostUsd: Number(r["input_cost_usd"] ?? 0) / 1_000_000,
            outputCostUsd: Number(r["output_cost_usd"] ?? 0) / 1_000_000,
            input: String(r["input"] ?? "") || null,
            output: String(r["output"] ?? "") || null,
            metadata: normMetadata(r["metadata"]),
          };
        }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(trace, null, 2) }],
      };
    }
  );

  // ── find_outliers ────────────────────────────────────────────────
  server.tool(
    "find_outliers",
    "Find the top N traces with the highest cost, duration, or token usage.",
    {
      metric: z.enum(["cost", "duration", "tokens"]).describe("The metric to sort by"),
      limit: z.number().int().min(1).max(50).default(10).describe("Number of outlier traces to return"),
    },
    async ({ metric, limit }) => {
      const orderBy =
        metric === "cost"     ? "cost_usd DESC" :
        metric === "duration" ? `dateDiff('millisecond', t.start_time, ${EFFECTIVE_END}) DESC` :
                                "(input_tokens + output_tokens) DESC";

      // For duration sort, only include traces where an effective end time is known.
      const durationFilter = metric === "duration"
        ? `HAVING isNotNull(${EFFECTIVE_END})`
        : "";

      const result = await clickhouse.query({
        query: `
          SELECT
            t.id,
            t.name,
            t.status,
            t.start_time,
            ${EFFECTIVE_END}                                      AS end_time,
            t.user_id,
            t.environment,
            coalesce(r.input_tokens, 0)                       AS input_tokens,
            coalesce(r.output_tokens, 0)                      AS output_tokens,
            coalesce(r.input_cost_usd + r.output_cost_usd, 0) AS cost_usd
          FROM (
            SELECT
              id,
              argMax(name, version)        AS name,
              argMax(status, version)      AS status,
              argMax(start_time, version)  AS start_time,
              argMax(end_time, version)    AS end_time,
              argMax(user_id, version)     AS user_id,
              argMax(environment, version) AS environment
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          ) t
          ${ROLLUPS_JOIN("projectId")}
          ${durationFilter}
          ORDER BY ${orderBy}
          LIMIT {limit: UInt32}
        `,
        query_params: { projectId, limit },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const traces = rows.map((r) => {
        const startTime = String(r["start_time"]);
        const endTime = r["end_time"] != null ? String(r["end_time"]) : null;
        return {
          id: String(r["id"]),
          name: String(r["name"]),
          status: String(r["status"]),
          startTime,
          endTime,
          durationMs: calcDuration(startTime, endTime),
          userId: String(r["user_id"] ?? "") || null,
          environment: String(r["environment"] ?? "") || null,
          inputTokens: Number(r["input_tokens"] ?? 0),
          outputTokens: Number(r["output_tokens"] ?? 0),
          costUsd: Number(r["cost_usd"] ?? 0) / 1_000_000,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(traces, null, 2) }],
      };
    }
  );

  // ── search_traces ────────────────────────────────────────────────
  server.tool(
    "search_traces",
    "Search traces by name (case-insensitive substring match).",
    {
      query: z.string().min(1).describe("Search string to match against trace names"),
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of results"),
    },
    async ({ query, limit }) => {
      const result = await clickhouse.query({
        query: `
          SELECT
            t.id,
            t.name,
            t.status,
            t.start_time,
            ${EFFECTIVE_END} AS end_time,
            t.user_id,
            t.environment
          FROM (
            SELECT
              id,
              argMax(name, version)        AS name,
              argMax(status, version)      AS status,
              argMax(start_time, version)  AS start_time,
              argMax(end_time, version)    AS end_time,
              argMax(user_id, version)     AS user_id,
              argMax(environment, version) AS environment
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          ) t
          ${ROLLUPS_JOIN("projectId")}
          WHERE lower(t.name) LIKE {pattern: String}
          ORDER BY t.start_time DESC
          LIMIT {limit: UInt32}
        `,
        query_params: {
          projectId,
          pattern: `%${query.toLowerCase()}%`,
          limit,
        },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const traces = rows.map((r) => {
        const startTime = String(r["start_time"]);
        const endTime = r["end_time"] != null ? String(r["end_time"]) : null;
        return {
          id: String(r["id"]),
          name: String(r["name"]),
          status: String(r["status"]),
          startTime,
          endTime,
          durationMs: calcDuration(startTime, endTime),
          userId: String(r["user_id"] ?? "") || null,
          environment: String(r["environment"] ?? "") || null,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(traces, null, 2) }],
      };
    }
  );

  return server;
}
