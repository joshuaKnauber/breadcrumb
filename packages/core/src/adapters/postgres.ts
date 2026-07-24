import { createRequire } from "node:module";
import type { DatabaseAdapter, ListOptions, SchemaState, TraceFilter } from "../db/types.js";
import { META_TABLE, SPANS_TABLE, spanColumns } from "../db/schema.js";
import { planMigration } from "../db/ddl.js";
import {
  clampLimit,
  costByDaySelect,
  costByFunctionSelect,
  keysetSql,
  type Placeholder,
  rowToRunSummary,
  rowToSessionSummary,
  rowToSpan,
  rowToTraceSummary,
  runSummarySelect,
  sessionSummarySelect,
  shapeCostSummary,
  shapeStats,
  spanToRow,
  statsSelect,
  traceFilterSql,
  traceSummarySelect,
} from "../db/rows.js";

/** Positional-param collector: each ph() call appends a value and yields "$n". */
function collector(): { values: unknown[]; ph: Placeholder } {
  const values: unknown[] = [];
  return { values, ph: (v) => (values.push(v), `$${values.length}`) };
}

/** Anything with a pg-compatible query method: pg.Pool, pg.Client, PGlite. */
export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function createPool(connectionString: string): PgQueryable & { end?: () => Promise<void> } {
  const require = createRequire(import.meta.url);
  try {
    const { Pool } = require("pg");
    return new Pool({ connectionString });
  } catch {
    throw new Error("The postgres adapter requires pg. Install it with: npm install pg");
  }
}

const COLUMN_NAMES = Object.keys(spanColumns);

/**
 * Postgres adapter. Pass a connection string (we create and own a small pool)
 * or your app's existing pg.Pool/pg.Client — recommended, one pool per app.
 */
export function postgres(connectionOrClient: string | PgQueryable): DatabaseAdapter {
  const ownsPool = typeof connectionOrClient === "string";
  const db = ownsPool ? createPool(connectionOrClient) : connectionOrClient;

  async function inspect(): Promise<SchemaState> {
    const columns = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [SPANS_TABLE]
    );
    const indexes = await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = $1`, [SPANS_TABLE]);
    const meta = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [META_TABLE]);
    return {
      spansExists: columns.rows.length > 0,
      spansColumns: new Set(columns.rows.map((r) => r.column_name as string)),
      indexNames: new Set(indexes.rows.map((r) => r.indexname as string)),
      metaExists: meta.rows.length > 0,
    };
  }

  return {
    id: "postgres",

    async inspectSchema() {
      return inspect();
    },

    async migrate() {
      const plan = planMigration("postgres", await inspect());
      for (const stmt of plan.statements) await db.query(stmt);
      return { createdTables: plan.createdTables, addedColumns: plan.addedColumns };
    },

    async claimSweep(now, intervalMs) {
      const { rows } = await db.query(
        `INSERT INTO ${META_TABLE} (key, value) VALUES ('last_sweep_at', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1 WHERE ${META_TABLE}.value <= $2
         RETURNING value`,
        [now, now - intervalMs]
      );
      return rows.length > 0;
    },

    async insertSpans(spans) {
      if (spans.length === 0) return;
      const values: unknown[] = [];
      const tuples = spans.map((span) => {
        const row = spanToRow(span);
        const placeholders = COLUMN_NAMES.map((col) => {
          values.push(row[col]);
          return `$${values.length}`;
        });
        return `(${placeholders.join(", ")})`;
      });
      const updates = COLUMN_NAMES.filter((c) => c !== "id")
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(", ");
      await db.query(
        `INSERT INTO ${SPANS_TABLE} (${COLUMN_NAMES.join(", ")}) VALUES ${tuples.join(", ")}
         ON CONFLICT (id) DO UPDATE SET ${updates}`,
        values
      );
    },

    async listTraces(options: ListOptions) {
      const { values, ph } = collector();
      const whereSql = traceFilterSql(SPANS_TABLE, options, ph);
      const havingSql = options.cursor
        ? keysetSql("MIN(start_time)", "trace_id", options.cursor, ph)
        : "";
      const sql = traceSummarySelect(SPANS_TABLE, whereSql, havingSql) + ` LIMIT ${ph(clampLimit(options.limit))}`;
      const { rows } = await db.query(sql, values);
      return rows.map(rowToTraceSummary);
    },

    async listSessions(options: ListOptions) {
      const { values, ph } = collector();
      const whereSql = traceFilterSql(SPANS_TABLE, options, ph);
      const havingSql = options.cursor
        ? keysetSql("MAX(t.end_time)", "COALESCE(t.session_id, t.trace_id)", options.cursor, ph)
        : "";
      const sql = sessionSummarySelect(SPANS_TABLE, whereSql, havingSql) + ` LIMIT ${ph(clampLimit(options.limit))}`;
      const { rows } = await db.query(sql, values);
      return rows.map(rowToSessionSummary);
    },

    async listRuns(sessionKey) {
      const { rows } = await db.query(runSummarySelect(SPANS_TABLE, "$1", "::text"), [sessionKey]);
      return rows.map(rowToRunSummary);
    },

    async listEnvironments() {
      const { rows } = await db.query(
        `SELECT DISTINCT environment FROM ${SPANS_TABLE} ORDER BY environment ASC`
      );
      return rows.map((r) => r.environment as string);
    },

    async costSummary(options) {
      const days = Math.min(Math.max(options.days ?? 14, 1), 90);
      const cutoff = Date.now() - days * 86_400_000;
      const values: unknown[] = [cutoff];
      let filter = "AND start_time >= $1";
      if (options.environment) {
        values.push(options.environment);
        filter += ` AND environment = $2`;
      }
      const dayExpr = "to_char(to_timestamp(start_time / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')";
      const dayRows = (await db.query(costByDaySelect(SPANS_TABLE, dayExpr, filter), values)).rows;
      const funcRows = (await db.query(costByFunctionSelect(SPANS_TABLE, filter), values)).rows;
      return shapeCostSummary(days, dayRows, funcRows);
    },

    async stats(filter: TraceFilter) {
      const { values, ph } = collector();
      const whereSql = traceFilterSql(SPANS_TABLE, filter, ph);
      const { rows } = await db.query(statsSelect(SPANS_TABLE, whereSql), values);
      return shapeStats(rows[0]);
    },

    async getTraceSpans(traceId) {
      const { rows } = await db.query(
        `SELECT * FROM ${SPANS_TABLE} WHERE trace_id = $1 ORDER BY start_time ASC, id ASC`,
        [traceId]
      );
      return rows.map(rowToSpan);
    },

    async getSpan(id) {
      const { rows } = await db.query(`SELECT * FROM ${SPANS_TABLE} WHERE id = $1 LIMIT 1`, [id]);
      return rows[0] ? rowToSpan(rows[0]) : null;
    },

    async deleteExpiredSpans(rules, limit) {
      let deleted = 0;
      const explicitEnvs = rules.filter((r) => r.environment !== null).map((r) => r.environment!);
      for (const rule of rules) {
        const remaining = limit - deleted;
        if (remaining <= 0) break;
        const values: unknown[] = [];
        let cond: string;
        if (rule.environment !== null) {
          values.push(rule.environment, rule.before);
          cond = `environment = $1 AND start_time < $2`;
        } else if (explicitEnvs.length > 0) {
          values.push(...explicitEnvs);
          const notIn = explicitEnvs.map((_, i) => `$${i + 1}`).join(", ");
          values.push(rule.before);
          cond = `environment NOT IN (${notIn}) AND start_time < $${values.length}`;
        } else {
          values.push(rule.before);
          cond = `start_time < $1`;
        }
        values.push(remaining);
        const { rows } = await db.query(
          `DELETE FROM ${SPANS_TABLE} WHERE id IN (
            SELECT id FROM ${SPANS_TABLE} WHERE ${cond} LIMIT $${values.length}
          ) RETURNING id`,
          values
        );
        deleted += rows.length;
      }
      return deleted;
    },

    async close() {
      if (ownsPool && "end" in db && typeof db.end === "function") await db.end();
    },
  };
}
