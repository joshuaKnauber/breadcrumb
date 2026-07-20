import { createRequire } from "node:module";
import type { DatabaseAdapter, ListTracesOptions } from "../db/types.js";
import { META_TABLE, SPANS_TABLE, spanColumns, spanIndexes, type ColumnSpec } from "../db/schema.js";
import {
  costByDaySelect,
  costByFunctionSelect,
  rowToRunSummary,
  rowToSessionSummary,
  rowToSpan,
  rowToTraceSummary,
  runSummarySelect,
  sessionSummarySelect,
  shapeCostSummary,
  spanToRow,
  traceSummarySelect,
} from "../db/rows.js";

const PG_TYPES = { text: "TEXT", integer: "BIGINT", real: "DOUBLE PRECISION", json: "JSONB" } as const;

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

function columnDdl(name: string, spec: ColumnSpec): string {
  const parts = [name, PG_TYPES[spec.type]];
  if (spec.primary) parts.push("PRIMARY KEY");
  if (!spec.nullable && !spec.primary) parts.push("NOT NULL");
  return parts.join(" ");
}

/**
 * Postgres adapter. Pass a connection string (we create and own a small pool)
 * or your app's existing pg.Pool/pg.Client — recommended, one pool per app.
 */
export function postgres(connectionOrClient: string | PgQueryable): DatabaseAdapter {
  const ownsPool = typeof connectionOrClient === "string";
  const db = ownsPool ? createPool(connectionOrClient) : connectionOrClient;

  return {
    id: "postgres",

    async migrate() {
      const createdTables: string[] = [];
      const addedColumns: string[] = [];

      const existing = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [SPANS_TABLE]
      );

      if (existing.rows.length === 0) {
        const cols = Object.entries(spanColumns)
          .map(([name, spec]) => columnDdl(name, spec))
          .join(", ");
        await db.query(`CREATE TABLE IF NOT EXISTS ${SPANS_TABLE} (${cols})`);
        createdTables.push(SPANS_TABLE);
      } else {
        const have = new Set(existing.rows.map((r) => r.column_name as string));
        for (const [name, spec] of Object.entries(spanColumns)) {
          if (have.has(name)) continue;
          // Additive columns are nullable so existing rows stay valid.
          await db.query(`ALTER TABLE ${SPANS_TABLE} ADD COLUMN IF NOT EXISTS ${name} ${PG_TYPES[spec.type]}`);
          addedColumns.push(`${SPANS_TABLE}.${name}`);
        }
      }

      for (const idx of spanIndexes) {
        await db.query(
          `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${SPANS_TABLE} (${idx.columns.join(", ")})`
        );
      }

      const meta = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [META_TABLE]
      );
      if (meta.rows.length === 0) {
        await db.query(
          `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value BIGINT NOT NULL)`
        );
        createdTables.push(META_TABLE);
      }
      return { createdTables, addedColumns };
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

    async listTraces(options: ListTracesOptions) {
      const values: unknown[] = [];
      let envFilter = "";
      if (options.environment) {
        values.push(options.environment);
        envFilter = `WHERE environment = $${values.length}`;
      }
      values.push(Math.min(options.limit ?? 50, 500));
      const sql = traceSummarySelect(SPANS_TABLE, envFilter) + ` LIMIT $${values.length}`;
      const { rows } = await db.query(sql, values);
      return rows.map(rowToTraceSummary);
    },

    async listSessions(options: ListTracesOptions) {
      const values: unknown[] = [];
      let envFilter = "";
      if (options.environment) {
        values.push(options.environment);
        envFilter = `WHERE environment = $${values.length}`;
      }
      values.push(Math.min(options.limit ?? 50, 500));
      const sql = sessionSummarySelect(SPANS_TABLE, envFilter) + ` LIMIT $${values.length}`;
      const { rows } = await db.query(sql, values);
      return rows.map(rowToSessionSummary);
    },

    async listRuns(sessionKey) {
      const { rows } = await db.query(runSummarySelect(SPANS_TABLE, "$1", "::text"), [sessionKey]);
      return rows.map(rowToRunSummary);
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

    async getTraceSpans(traceId) {
      const { rows } = await db.query(
        `SELECT * FROM ${SPANS_TABLE} WHERE trace_id = $1 ORDER BY start_time ASC, id ASC`,
        [traceId]
      );
      return rows.map(rowToSpan);
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
