import { z } from "zod";
import { router, procedure } from "../trpc.js";
import { clickhouse } from "../../db/clickhouse.js";

export const tracesRouter = router({
  // Aggregated stats for the project dashboard header cards.
  // Joins traces with trace_rollups to get totals.
  stats: procedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT
            count()                          AS trace_count,
            sum(r.total_cost_usd)            AS total_cost_usd
          FROM (
            SELECT
              id,
              argMax(status, version) AS status
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          ) t
          LEFT JOIN (
            SELECT
              trace_id,
              sum(input_cost_usd + output_cost_usd) AS total_cost_usd
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
        // Stored as micro-dollars — divide by 1_000_000 for display
        totalCostUsd: Number(row["total_cost_usd"] ?? 0) / 1_000_000,
      };
    }),

  // Paginated trace list for the dashboard table.
  // Uses argMax to resolve the latest version of each trace row,
  // and joins trace_rollups for per-trace token/cost totals.
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
            t.id                                              AS id,
            t.name                                            AS name,
            t.status                                          AS status,
            t.status_message                                  AS status_message,
            t.start_time                                      AS start_time,
            t.end_time                                        AS end_time,
            t.user_id                                         AS user_id,
            t.environment                                     AS environment,
            coalesce(r.input_tokens, 0)                       AS input_tokens,
            coalesce(r.output_tokens, 0)                      AS output_tokens,
            coalesce(r.input_cost_usd + r.output_cost_usd, 0) AS cost_usd,
            coalesce(r.span_count, 0)                         AS span_count
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
            SELECT
              trace_id,
              sum(input_tokens)                     AS input_tokens,
              sum(output_tokens)                    AS output_tokens,
              sum(input_cost_usd)                   AS input_cost_usd,
              sum(output_cost_usd)                  AS output_cost_usd,
              sum(span_count)                       AS span_count
            FROM breadcrumb.trace_rollups
            WHERE project_id = {projectId: UUID}
            GROUP BY trace_id
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
        endTime:       String(r["end_time"]),
        userId:        String(r["user_id"] ?? ""),
        environment:   String(r["environment"] ?? ""),
        inputTokens:   Number(r["input_tokens"] ?? 0),
        outputTokens:  Number(r["output_tokens"] ?? 0),
        // Micro-dollars → dollars
        costUsd:       Number(r["cost_usd"] ?? 0) / 1_000_000,
        spanCount:     Number(r["span_count"] ?? 0),
      }));
    }),

  // All spans for a single trace, ordered by start_time.
  // Used by the sidesheet to render the span hierarchy.
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
        // Micro-dollars → dollars
        inputCostUsd:  Number(r["input_cost_usd"] ?? 0) / 1_000_000,
        outputCostUsd: Number(r["output_cost_usd"] ?? 0) / 1_000_000,
        input:         String(r["input"] ?? ""),
        output:        String(r["output"] ?? ""),
        metadata:      String(r["metadata"] ?? ""),
      }));
    }),
});
