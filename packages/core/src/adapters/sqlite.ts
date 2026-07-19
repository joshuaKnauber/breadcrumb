import { createRequire } from "node:module";
import type DatabaseType from "better-sqlite3";
import type {
  DatabaseAdapter,
  ListTracesOptions,
  SpanRecord,
  TraceSummary,
} from "../db/types.js";
import { SPANS_TABLE, spanColumns, spanIndexes } from "../db/schema.js";

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

function toRow(span: SpanRecord): Record<string, unknown> {
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

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function fromRow(row: Record<string, unknown>): SpanRecord {
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
    inputTokens: (row.input_tokens as number | null) ?? null,
    outputTokens: (row.output_tokens as number | null) ?? null,
    cost: (row.cost as number | null) ?? null,
    status: row.status as SpanRecord["status"],
    error: (row.error as string | null) ?? null,
    input: parseJson(row.input),
    output: parseJson(row.output),
    metadata: parseJson(row.metadata) as Record<string, unknown> | null,
    startTime: row.start_time as number,
    endTime: (row.end_time as number | null) ?? null,
  };
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
      const cols = Object.entries(spanColumns)
        .map(([name, spec]) => {
          const parts = [name, SQLITE_TYPES[spec.type]];
          if (spec.primary) parts.push("PRIMARY KEY");
          if (!spec.nullable && !spec.primary) parts.push("NOT NULL");
          return parts.join(" ");
        })
        .join(", ");
      db.exec(`CREATE TABLE IF NOT EXISTS ${SPANS_TABLE} (${cols})`);
      for (const idx of spanIndexes) {
        db.exec(
          `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${SPANS_TABLE} (${idx.columns.join(", ")})`
        );
      }
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
      insertAll(spans.map(toRow));
    },

    async listTraces(options: ListTracesOptions) {
      const limit = Math.min(options.limit ?? 50, 500);
      const envFilter = options.environment ? "WHERE environment = @environment" : "";
      const rows = db
        .prepare(
          `SELECT
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
          FROM ${SPANS_TABLE}
          ${envFilter}
          GROUP BY trace_id
          ORDER BY MIN(start_time) DESC
          LIMIT @limit`
        )
        .all({ limit, ...(options.environment ? { environment: options.environment } : {}) }) as Record<string, unknown>[];

      return rows.map(
        (row): TraceSummary => ({
          traceId: row.trace_id as string,
          name: row.name as string,
          environment: row.environment as string,
          userId: (row.user_id as string | null) ?? null,
          sessionId: (row.session_id as string | null) ?? null,
          startTime: row.start_time as number,
          endTime: (row.end_time as number | null) ?? null,
          spanCount: row.span_count as number,
          errorCount: (row.error_count as number) ?? 0,
          inputTokens: (row.input_tokens as number) ?? 0,
          outputTokens: (row.output_tokens as number) ?? 0,
          cost: (row.cost as number | null) ?? null,
        })
      );
    },

    async getTraceSpans(traceId) {
      const rows = db
        .prepare(`SELECT * FROM ${SPANS_TABLE} WHERE trace_id = ? ORDER BY start_time ASC`)
        .all(traceId) as Record<string, unknown>[];
      return rows.map(fromRow);
    },

    async close() {
      db.close();
    },
  };
}
