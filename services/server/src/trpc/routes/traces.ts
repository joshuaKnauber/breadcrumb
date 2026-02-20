import { z } from "zod";
import { router, procedure } from "../trpc.js";
import { clickhouse } from "../../db/clickhouse.js";

// Reusable rollups subquery fragment.
// max(max_end_time) gives the latest span end time for each trace,
// used as a fallback when trace.end_time is NULL.
const ROLLUPS_SUBQUERY = (projectIdParam: string) => `
  SELECT
    trace_id,
    sum(input_tokens)                     AS input_tokens,
    sum(output_tokens)                    AS output_tokens,
    sum(input_cost_usd)                   AS input_cost_usd,
    sum(output_cost_usd)                  AS output_cost_usd,
    sum(span_count)                       AS span_count,
    max(max_end_time)                     AS max_end_time
  FROM breadcrumb.trace_rollups
  WHERE project_id = {${projectIdParam}: UUID}
  GROUP BY trace_id
`;

export const tracesRouter = router({
  // Aggregated stats for the project dashboard header cards.
  stats: procedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT
            count()                AS trace_count,
            sum(r.total_cost_usd)  AS total_cost_usd,
            avgIf(
              toInt64(toUnixTimestamp64Milli(COALESCE(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)),
              isNotNull(COALESCE(t.end_time, r.max_end_time)) AND COALESCE(t.end_time, r.max_end_time) > t.start_time
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
        query_params: { projectId: input.projectId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};

      return {
        traceCount: Number(row["trace_count"] ?? 0),
        totalCostUsd: Number(row["total_cost_usd"] ?? 0) / 1_000_000,
      };
    }),

  // Paginated trace list for the dashboard table.
  list: procedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT
            t.id,
            t.name,
            t.status,
            t.status_message,
            t.start_time,
            COALESCE(t.end_time, r.max_end_time)               AS end_time,
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
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          ) t
          LEFT JOIN (
            ${ROLLUPS_SUBQUERY("projectId")}
          ) r ON t.id = r.trace_id
          ORDER BY t.start_time DESC
          LIMIT {limit: UInt32} OFFSET {offset: UInt32}
        `,
        query_params: {
          projectId: input.projectId,
          limit: input.limit,
          offset: input.offset,
        },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;

      return rows.map((r) => ({
        id:            String(r["id"]),
        name:          String(r["name"]),
        status:        String(r["status"]) as "ok" | "error",
        statusMessage: String(r["status_message"] ?? ""),
        startTime:     String(r["start_time"]),
        endTime:       r["end_time"] != null ? String(r["end_time"]) : null,
        userId:        String(r["user_id"] ?? ""),
        environment:   String(r["environment"] ?? ""),
        inputTokens:   Number(r["input_tokens"] ?? 0),
        outputTokens:  Number(r["output_tokens"] ?? 0),
        costUsd:       Number(r["cost_usd"] ?? 0) / 1_000_000,
        spanCount:     Number(r["span_count"] ?? 0),
      }));
    }),

  // Traces grouped by day, for the sparkline on the Overview page.
  dailyCount: procedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        days: z.number().int().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT
            toDate(start_time) AS day,
            count()            AS trace_count
          FROM (
            SELECT
              id,
              argMax(start_time, version) AS start_time
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE start_time >= today() - {days: UInt32} + 1
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: { projectId: input.projectId, days: input.days },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        date:  String(r["day"]),
        count: Number(r["trace_count"]),
      }));
    }),

  // All spans for a single trace, ordered by start_time.
  spans: procedure
    .input(z.object({ projectId: z.string().uuid(), traceId: z.string() }))
    .query(async ({ input }) => {
      const result = await clickhouse.query({
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
            AND trace_id  = {traceId: String}
          ORDER BY start_time ASC
        `,
        query_params: { projectId: input.projectId, traceId: input.traceId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;

      return rows.map((r) => ({
        id:            String(r["id"]),
        parentSpanId:  String(r["parent_span_id"] ?? ""),
        name:          String(r["name"]),
        type:          String(r["type"]),
        status:        String(r["status"]) as "ok" | "error",
        statusMessage: String(r["status_message"] ?? ""),
        startTime:     String(r["start_time"]),
        endTime:       String(r["end_time"]),
        provider:      String(r["provider"] ?? ""),
        model:         String(r["model"] ?? ""),
        inputTokens:   Number(r["input_tokens"] ?? 0),
        outputTokens:  Number(r["output_tokens"] ?? 0),
        inputCostUsd:  Number(r["input_cost_usd"] ?? 0) / 1_000_000,
        outputCostUsd: Number(r["output_cost_usd"] ?? 0) / 1_000_000,
        input:         String(r["input"] ?? ""),
        output:        String(r["output"] ?? ""),
        metadata:      String(r["metadata"] ?? ""),
      }));
    }),
});
