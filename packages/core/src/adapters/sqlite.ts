import { createRequire } from "node:module";
import type DatabaseType from "better-sqlite3";
import type { DatabaseAdapter, ListOptions, SchemaState, TraceFilter } from "../db/types.js";
import { MCP_KEYS_TABLE, META_TABLE, SPANS_TABLE, spanColumns } from "../db/schema.js";
import { planMigration } from "../db/ddl.js";
import {
  clampLimit,
  costByDaySelect,
  costByFunctionSelect,
  keysetSql,
  type Placeholder,
  type McpKeyRow,
  rowToMcpKey,
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

/** Positional-param collector: each ph() call appends a value and yields "?". */
function collector(): { params: unknown[]; ph: Placeholder } {
  const params: unknown[] = [];
  return { params, ph: (v) => (params.push(v), "?") };
}

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

  const tableExists = (name: string) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

  function inspect(): SchemaState {
    const spansExists = tableExists(SPANS_TABLE);
    return {
      spansExists,
      spansColumns: new Set(
        spansExists
          ? (db.prepare(`PRAGMA table_info(${SPANS_TABLE})`).all() as { name: string }[]).map((c) => c.name)
          : []
      ),
      indexNames: new Set(
        (
          db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN (?, ?)")
            .all(SPANS_TABLE, MCP_KEYS_TABLE) as { name: string }[]
        ).map((r) => r.name)
      ),
      metaExists: tableExists(META_TABLE),
      mcpKeysExists: tableExists(MCP_KEYS_TABLE),
    };
  }

  return {
    id: "sqlite",

    client() {
      return db;
    },

    async inspectSchema() {
      return inspect();
    },

    async listMcpKeys() {
      const rows = db
        .prepare(
          `SELECT id, name, key_prefix, created_at, last_used_at
           FROM ${MCP_KEYS_TABLE} ORDER BY created_at DESC`
        )
        .all() as McpKeyRow[];
      return rows.map(rowToMcpKey);
    },

    async insertMcpKey(record) {
      db.prepare(
        `INSERT INTO ${MCP_KEYS_TABLE} (id, name, key_hash, key_prefix, created_at, last_used_at)
         VALUES (@id, @name, @key_hash, @key_prefix, @created_at, @last_used_at)`
      ).run({
        id: record.id,
        name: record.name,
        key_hash: record.keyHash,
        key_prefix: record.keyPrefix,
        created_at: record.createdAt,
        last_used_at: record.lastUsedAt,
      });
    },

    async findMcpKeyByHash(keyHash) {
      const row = db
        .prepare(
          `SELECT id, name, key_prefix, created_at, last_used_at
           FROM ${MCP_KEYS_TABLE} WHERE key_hash = ?`
        )
        .get(keyHash) as McpKeyRow | undefined;
      return row ? rowToMcpKey(row) : null;
    },

    async deleteMcpKey(id) {
      return db.prepare(`DELETE FROM ${MCP_KEYS_TABLE} WHERE id = ?`).run(id).changes > 0;
    },

    async touchMcpKey(id, at) {
      db.prepare(`UPDATE ${MCP_KEYS_TABLE} SET last_used_at = ? WHERE id = ?`).run(at, id);
    },

    async migrate() {
      const plan = planMigration("sqlite", inspect());
      for (const stmt of plan.statements) db.exec(stmt);
      return { createdTables: plan.createdTables, addedColumns: plan.addedColumns };
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

    async listTraces(options: ListOptions) {
      const { params, ph } = collector();
      const whereSql = traceFilterSql(SPANS_TABLE, options, ph);
      const havingSql = options.cursor
        ? keysetSql("MIN(start_time)", "trace_id", options.cursor, ph)
        : "";
      const sql = traceSummarySelect(SPANS_TABLE, whereSql, havingSql) + ` LIMIT ${ph(clampLimit(options.limit))}`;
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map(rowToTraceSummary);
    },

    async listSessions(options: ListOptions) {
      const { params, ph } = collector();
      const whereSql = traceFilterSql(SPANS_TABLE, options, ph);
      const havingSql = options.cursor
        ? keysetSql("MAX(t.end_time)", "COALESCE(t.session_id, t.trace_id)", options.cursor, ph)
        : "";
      const sql = sessionSummarySelect(SPANS_TABLE, whereSql, havingSql) + ` LIMIT ${ph(clampLimit(options.limit))}`;
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map(rowToSessionSummary);
    },

    async listRuns(sessionKey) {
      const rows = db
        .prepare(runSummarySelect(SPANS_TABLE, "?", ""))
        .all(sessionKey) as Record<string, unknown>[];
      return rows.map(rowToRunSummary);
    },

    async listEnvironments() {
      const rows = db
        .prepare(`SELECT DISTINCT environment FROM ${SPANS_TABLE} ORDER BY environment ASC`)
        .all() as { environment: string }[];
      return rows.map((r) => r.environment);
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

    async stats(filter: TraceFilter) {
      const { params, ph } = collector();
      const whereSql = traceFilterSql(SPANS_TABLE, filter, ph);
      const row = db.prepare(statsSelect(SPANS_TABLE, whereSql)).get(...params) as
        | Record<string, unknown>
        | undefined;
      return shapeStats(row);
    },

    async getTraceSpans(traceId) {
      const rows = db
        .prepare(`SELECT * FROM ${SPANS_TABLE} WHERE trace_id = ? ORDER BY start_time ASC, id ASC`)
        .all(traceId) as Record<string, unknown>[];
      return rows.map(rowToSpan);
    },

    async getSpan(id) {
      const row = db.prepare(`SELECT * FROM ${SPANS_TABLE} WHERE id = ? LIMIT 1`).get(id) as
        | Record<string, unknown>
        | undefined;
      return row ? rowToSpan(row) : null;
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
