export type ColumnType = "text" | "integer" | "real" | "json";

export interface ColumnSpec {
  type: ColumnType;
  nullable?: boolean;
  primary?: boolean;
}

/**
 * Single source of truth for breadcrumb's tables. Adapters generate their
 * DDL from this; the CLI's migrate/generate will diff against it.
 * Tables live in the user's database, so everything is prefixed.
 */
export const SPANS_TABLE = "breadcrumb_spans";

export const spanColumns: Record<string, ColumnSpec> = {
  id: { type: "text", primary: true },
  trace_id: { type: "text" },
  parent_span_id: { type: "text", nullable: true },
  name: { type: "text" },
  kind: { type: "text" },
  environment: { type: "text" },
  user_id: { type: "text", nullable: true },
  session_id: { type: "text", nullable: true },
  model: { type: "text", nullable: true },
  provider: { type: "text", nullable: true },
  input_tokens: { type: "integer", nullable: true },
  output_tokens: { type: "integer", nullable: true },
  cached_input_tokens: { type: "integer", nullable: true },
  cache_write_tokens: { type: "integer", nullable: true },
  reasoning_tokens: { type: "integer", nullable: true },
  cost: { type: "real", nullable: true },
  status: { type: "text" },
  error: { type: "text", nullable: true },
  input: { type: "json", nullable: true },
  output: { type: "json", nullable: true },
  metadata: { type: "json", nullable: true },
  start_time: { type: "integer" },
  end_time: { type: "integer", nullable: true },
};

export const spanIndexes: { name: string; columns: string[] }[] = [
  { name: "breadcrumb_spans_trace_id", columns: ["trace_id"] },
  { name: "breadcrumb_spans_env_start", columns: ["environment", "start_time"] },
  // Back the query-surface filters (traceFilterSql). Composite with trace_id so
  // the `trace_id IN (SELECT trace_id WHERE <col> = ?)` subqueries stay index-only.
  { name: "breadcrumb_spans_user_id", columns: ["user_id", "trace_id"] },
  { name: "breadcrumb_spans_model", columns: ["model", "trace_id"] },
  { name: "breadcrumb_spans_status", columns: ["status", "trace_id"] },
];

/** Tiny key/value table for cross-instance coordination (sweep claims). */
export const META_TABLE = "breadcrumb_meta";

export const metaColumns: Record<string, ColumnSpec> = {
  key: { type: "text", primary: true },
  value: { type: "integer" },
};

/**
 * Keys that let a coding agent read traces over MCP. Created from the dashboard
 * (so whoever can already see traces can mint one) and presented as a bearer
 * token. Only the SHA-256 hash is stored — the token itself is shown once at
 * creation and is unrecoverable afterwards, so a database leak yields nothing
 * replayable. `key_prefix` exists purely so the UI can tell two keys apart.
 */
export const MCP_KEYS_TABLE = "breadcrumb_mcp_keys";

export const mcpKeyColumns: Record<string, ColumnSpec> = {
  id: { type: "text", primary: true },
  name: { type: "text" },
  key_hash: { type: "text" },
  key_prefix: { type: "text" },
  created_at: { type: "integer" },
  last_used_at: { type: "integer", nullable: true },
};

export const mcpKeyIndexes: { name: string; columns: string[]; unique?: boolean }[] = [
  // Every MCP request resolves a key by hash, so this lookup must be indexed.
  // Unique doubles as a guard against storing the same token twice.
  { name: "breadcrumb_mcp_keys_hash", columns: ["key_hash"], unique: true },
];
