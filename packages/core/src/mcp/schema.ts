import type { FieldSchema, FieldType, SchemaMap } from "@valv/core";
import { SPANS_TABLE } from "../db/schema.js";
import type { Dialect } from "../db/types.js";

/**
 * The span table, declared for valv rather than introspected.
 *
 * Breadcrumb owns this schema, so probing the database would only rediscover
 * what is already known — and would also surface `breadcrumb_meta` and
 * `breadcrumb_mcp_keys`, which the agent must never see. Declaring one resource
 * means the agent's reachable surface is exactly this table, by construction.
 *
 * The descriptions are load-bearing: they are the only thing telling the model
 * that durations are epoch milliseconds, that a trace is a set of spans rather
 * than a row, and which columns are worth grouping by.
 */

// Only ClickHouse's typed placeholders read nativeType, so for these two
// dialects it is documentation — but wrong documentation is worse than none.
const NATIVE: Record<Dialect, Record<"text" | "integer" | "real" | "json", string>> = {
  postgres: { text: "TEXT", integer: "BIGINT", real: "DOUBLE PRECISION", json: "JSONB" },
  sqlite: { text: "TEXT", integer: "INTEGER", real: "REAL", json: "TEXT" },
};

export const SPAN_KINDS = ["span", "llm", "tool", "embedding", "retrieval", "agent"] as const;

interface Col {
  type: FieldType;
  native: "text" | "integer" | "real" | "json";
  nullable?: boolean;
  id?: boolean;
  enumValues?: readonly string[];
  description: string;
}

const COLUMNS: Record<string, Col> = {
  id: { type: "string", native: "text", id: true, description: "Unique span id." },
  trace_id: {
    type: "string",
    native: "text",
    description:
      "Groups spans into one trace (a single run). A trace is not a row — aggregate over this to reason about a run.",
  },
  parent_span_id: {
    type: "string",
    native: "text",
    nullable: true,
    description:
      "Parent span's id. NULL marks the trace's root span, whose name is the run's name. It can also be non-NULL and point at a span that is not in this table, when another tracer owns the span above it — treat the trace's earliest span as its root in that case.",
  },
  name: { type: "string", native: "text", description: "Operation name, e.g. the tool or function called." },
  function_id: {
    type: "string",
    native: "text",
    nullable: true,
    description:
      "The operation the caller named (functionId), carried by every span of that call. Group cost and latency by this to attribute them to a function; NULL for spans that were never named.",
  },
  kind: {
    type: "enum",
    native: "text",
    enumValues: SPAN_KINDS,
    description: "What produced the span. 'llm' spans carry model, tokens and cost.",
  },
  environment: {
    type: "string",
    native: "text",
    description: "Deployment environment, e.g. 'production' or 'development'.",
  },
  user_id: { type: "string", native: "text", nullable: true, description: "Your app's end-user id, if set." },
  session_id: {
    type: "string",
    native: "text",
    nullable: true,
    description: "Groups related traces into a session. NULL when the run was not part of one.",
  },
  model: {
    type: "string",
    native: "text",
    nullable: true,
    description: "Model name for llm spans, e.g. 'claude-sonnet-5'. Useful to group cost and latency by.",
  },
  provider: { type: "string", native: "text", nullable: true, description: "Model provider, e.g. 'anthropic'." },
  input_tokens: { type: "number", native: "integer", nullable: true, description: "Prompt tokens." },
  output_tokens: { type: "number", native: "integer", nullable: true, description: "Completion tokens." },
  cached_input_tokens: { type: "number", native: "integer", nullable: true, description: "Prompt tokens served from cache." },
  cache_write_tokens: { type: "number", native: "integer", nullable: true, description: "Tokens written to the prompt cache." },
  reasoning_tokens: { type: "number", native: "integer", nullable: true, description: "Reasoning tokens, when the model reports them." },
  cost: {
    type: "number",
    native: "real",
    nullable: true,
    description: "Cost in USD. NULL when no price is configured for the model — not the same as zero.",
  },
  status: {
    type: "enum",
    native: "text",
    enumValues: ["ok", "error"],
    description: "Span outcome. Filter on 'error' to find failures.",
  },
  error: { type: "string", native: "text", nullable: true, description: "Error message when status is 'error'." },
  input: {
    type: "json",
    native: "json",
    nullable: true,
    description: "Captured input payload (prompt or arguments). May be truncated, and may be redacted.",
  },
  output: {
    type: "json",
    native: "json",
    nullable: true,
    description: "Captured output payload (completion or return value). May be truncated, and may be redacted.",
  },
  metadata: { type: "json", native: "json", nullable: true, description: "Arbitrary metadata attached at trace time." },
  start_time: {
    type: "number",
    native: "integer",
    description:
      "Start time as epoch MILLISECONDS, stored as an integer — not a date. Compare against epoch-ms numbers; date functions do not apply.",
  },
  end_time: {
    type: "number",
    native: "integer",
    nullable: true,
    description:
      "End time as epoch MILLISECONDS. NULL if the span never completed. Duration is end_time - start_time.",
  },
};

/**
 * Build the valv schema for a dialect.
 *
 * Note the timestamps are declared `number`, not `date`. They really are epoch
 * milliseconds in an integer column, and calling them dates would hand the model
 * date functions that silently misread them (SQLite's strftime would parse the
 * integer as a Julian day and bucket into the wrong era).
 */
export function spanSchema(dialect: Dialect): SchemaMap {
  const fields: Record<string, FieldSchema> = {};
  for (const [name, col] of Object.entries(COLUMNS)) {
    fields[name] = {
      name,
      type: col.type,
      nativeType: NATIVE[dialect][col.native],
      isNullable: col.nullable ?? false,
      isId: col.id ?? false,
      isPrimaryKeyPart: col.id ?? false,
      description: col.description,
      ...(col.enumValues ? { enumValues: [...col.enumValues] } : {}),
    };
  }

  return {
    resources: {
      [SPANS_TABLE]: {
        name: SPANS_TABLE,
        tableName: SPANS_TABLE,
        description:
          "LLM and agent execution spans. One row per operation; spans sharing a trace_id form one run. " +
          "Timestamps are epoch milliseconds.",
        fields,
        relations: {},
      },
    },
  };
}
