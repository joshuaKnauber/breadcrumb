import { createRequire } from "node:module";
import type DatabaseType from "better-sqlite3";
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

const SQLITE_TYPES = { text: "TEXT", integer: "INTEGER", real: "REAL", json: "TEXT" } as const;

function loadDriver(): typeof DatabaseType {
  const require = createRequire(import.meta.url);
  try {
    return require("better-sqlite3");
  } catch {
    throw new Error(
      "The sqlite adapter requires better-sqlite3. Install it with: npm install better-sqlite3"
    );
  }
}

const COLUMN_NAMES = Object.keys(spanColumns);

function columnDdl(name: string, spec: ColumnSpec): string {
  const parts = [name, SQLITE_TYPES[spec.type]];
  if (spec.primary) parts.push("PRIMARY KEY");
  if (!spec.nullable && !spec.primary) parts.push("NOT NULL");
  return parts.join(" ");
}

/**
 * SQLite adapter. Pass a file path (created if missing) or an existing
 * better-sqlite3 Database instance.
 */
export function sqlite(fileOrDb: string | DatabaseType.Database): DatabaseAdapter {
  let db: DatabaseType.Database;
  if (typeof fileOrDb === "string") {
    const Database = loadDriver();
    db = new Database(fileOrDb);
    db.pragma("journal_mode = WAL");
  } else {
    db = fileOrDb;
  }

  return {
    id: "sqlite",

    async migrate() {
      const createdTables: string[] = [];
      const addedColumns: string[] = [];

      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(SPANS_TABLE);

      if (!exists) {
        const cols = Object.entries(spanColumns)
          .map(([name, spec]) => columnDdl(name, spec))
          .join(", ");
        db.exec(`CREATE TABLE ${SPANS_TABLE} (${cols})`);
        createdTables.push(SPANS_TABLE);
      } else {
        const existing = new Set(
          (db.prepare(`PRAGMA table_info(${SPANS_TABLE})`).all() as { name: string }[]).map(
            (c) => c.name
          )
        );
        for (const [name, spec] of Object.entries(spanColumns)) {
          if (existing.has(name)) continue;
          // ALTER TABLE can't add NOT NULL without default — additive columns are nullable.
          db.exec(`ALTER TABLE ${SPANS_TABLE} ADD COLUMN ${name} ${SQLITE_TYPES[spec.type]}`);
          addedColumns.push(`${SPANS_TABLE}.${name}`);
        }
      }

      for (const idx of spanIndexes) {
        db.exec(
          `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${SPANS_TABLE} (${idx.columns.join(", ")})`
        );
      }

      const metaExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(META_TABLE);
      if (!metaExists) {
        db.exec(`CREATE TABLE ${META_TABLE} (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`);
        createdTables.push(META_TABLE);
      }
      return { createdTables, addedColumns };
    },

    async claimSweep(now, intervalMs) {
      const rows = db
        .prepare(
          `INSERT INTO ${META_TABLE} (key, value) VALUES ('last_sweep_at', @now)
           ON CONFLICT (key) DO UPDATE SET value = @now WHERE ${META_TABLE}.value <= @cutoff
           RETURNING value`
        )
        .all({ now, cutoff: now - intervalMs });
      return rows.length > 0;
    },

    async insertSpans(spans) {
      if (spans.length === 0) return;
      const placeholders = COLUMN_NAMES.map((c) => `@${c}`).join(", ");
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${SPANS_TABLE} (${COLUMN_NAMES.join(", ")}) VALUES (${placeholders})`
      );
      const insertAll = db.transaction((rows: Record<string, unknown>[]) => {
        for (const row of rows) stmt.run(row);
      });
      insertAll(spans.map(spanToRow));
    },

    async listTraces(options: ListTracesOptions) {
      const limit = Math.min(options.limit ?? 50, 500);
      const sql =
        traceSummarySelect(SPANS_TABLE, options.environment ? "WHERE environment = @environment" : "") +
        " LIMIT @limit";
      const rows = db
        .prepare(sql)
        .all({ limit, ...(options.environment ? { environment: options.environment } : {}) }) as Record<string, unknown>[];
      return rows.map(rowToTraceSummary);
    },

    async listSessions(options: ListTracesOptions) {
      const limit = Math.min(options.limit ?? 50, 500);
      const sql =
        sessionSummarySelect(SPANS_TABLE, options.environment ? "WHERE environment = @environment" : "") +
        " LIMIT @limit";
      const rows = db
        .prepare(sql)
        .all({ limit, ...(options.environment ? { environment: options.environment } : {}) }) as Record<string, unknown>[];
      return rows.map(rowToSessionSummary);
    },

    async listRuns(sessionKey) {
      const rows = db
        .prepare(runSummarySelect(SPANS_TABLE, "?", ""))
        .all(sessionKey) as Record<string, unknown>[];
      return rows.map(rowToRunSummary);
    },

    async costSummary(options) {
      const days = Math.min(Math.max(options.days ?? 14, 1), 90);
      const cutoff = Date.now() - days * 86_400_000;
      const params = { cutoff, ...(options.environment ? { environment: options.environment } : {}) };
      const envFilter = options.environment ? "AND environment = @environment" : "";
      const dayExpr = "strftime('%Y-%m-%d', start_time / 1000, 'unixepoch')";
      const dayRows = db
        .prepare(costByDaySelect(SPANS_TABLE, dayExpr, `AND start_time >= @cutoff ${envFilter}`))
        .all(params) as Record<string, unknown>[];
      const funcRows = db
        .prepare(costByFunctionSelect(SPANS_TABLE, `AND start_time >= @cutoff ${envFilter}`))
        .all(params) as Record<string, unknown>[];
      return shapeCostSummary(days, dayRows, funcRows);
    },

    async getTraceSpans(traceId) {
      const rows = db
        .prepare(`SELECT * FROM ${SPANS_TABLE} WHERE trace_id = ? ORDER BY start_time ASC, id ASC`)
        .all(traceId) as Record<string, unknown>[];
      return rows.map(rowToSpan);
    },

    async deleteExpiredSpans(rules, limit) {
      let deleted = 0;
      const explicitEnvs = rules.filter((r) => r.environment !== null).map((r) => r.environment!);
      for (const rule of rules) {
        const remaining = limit - deleted;
        if (remaining <= 0) break;
        let cond: string;
        const params: unknown[] = [];
        if (rule.environment !== null) {
          cond = "environment = ? AND start_time < ?";
          params.push(rule.environment, rule.before);
        } else {
          const notIn = explicitEnvs.map(() => "?").join(", ");
          cond = explicitEnvs.length > 0
            ? `environment NOT IN (${notIn}) AND start_time < ?`
            : "start_time < ?";
          params.push(...explicitEnvs, rule.before);
        }
        const result = db
          .prepare(
            `DELETE FROM ${SPANS_TABLE} WHERE id IN (
              SELECT id FROM ${SPANS_TABLE} WHERE ${cond} LIMIT ?
            )`
          )
          .run(...params, remaining);
        deleted += result.changes;
      }
      return deleted;
    },

    async close() {
      db.close();
    },
  };
}
