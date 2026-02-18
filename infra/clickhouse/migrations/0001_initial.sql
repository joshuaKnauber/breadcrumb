-- ============================================================
-- Breadcrumb ClickHouse Schema
-- ============================================================
--
-- Design principles:
--
--   1. INSERT-ONLY for spans. Spans are written once when they
--      complete and never updated or deleted.
--
--   2. ReplacingMergeTree for traces. A trace row is inserted
--      on start and again on end (with a higher version). CH
--      deduplicates in the background, keeping the highest version.
--      Query with argMax(), not FINAL — see traces table below.
--
--   3. SummingMergeTree + materialized view for rollups. Every
--      span insert automatically feeds trace_rollups via a
--      materialized view. CH merges rows in the background.
--      Always query with explicit GROUP BY + sum(), not FINAL.
--
--   4. Costs stored as UInt64 micro-dollars (1 USD = 1_000_000).
--      Float64 accumulates precision errors when summing many
--      small values. Integer arithmetic is exact. Divide by
--      1_000_000 at display time.
--
--   5. LowCardinality(String) for fields with few distinct values
--      (status, type, provider, environment). Dramatically reduces
--      storage and speeds up filtering on these columns.
--
--   6. No Nullable columns. ClickHouse performs better with empty
--      string / zero defaults than with Nullable types.
--
-- ============================================================

CREATE DATABASE IF NOT EXISTS breadcrumb;

-- ============================================================
-- traces
-- ============================================================
-- One logical trace = up to two physical rows:
--   version 1 — inserted by SDK on trace.start() with metadata
--   version 2 — inserted by SDK on trace.end() with final status/output
--
-- ReplacingMergeTree(version) deduplicates by ORDER BY key
-- (project_id, id), keeping the row with the highest version.
-- Deduplication happens in the background — not guaranteed at
-- read time.
--
-- DO NOT use FINAL to read this table. FINAL forces a synchronous
-- merge, disables parallel reads, and degrades badly at scale.
--
-- Use the argMax pattern instead:
--
--   SELECT
--     id,
--     argMax(name, version)          AS name,
--     argMax(start_time, version)    AS start_time,
--     argMax(end_time, version)      AS end_time,
--     argMax(status, version)        AS status,
--     argMax(status_message, version) AS status_message,
--     argMax(input, version)         AS input,
--     argMax(output, version)        AS output,
--     argMax(user_id, version)       AS user_id,
--     argMax(session_id, version)    AS session_id,
--     argMax(environment, version)   AS environment,
--     argMax(tags, version)          AS tags
--   FROM breadcrumb.traces
--   WHERE project_id = ?
--   GROUP BY id
--
-- This reads all rows for each trace_id and picks the value
-- from the highest version, which is correct and parallelisable.
-- ============================================================

CREATE TABLE IF NOT EXISTS breadcrumb.traces
(
    -- Identity
    id          String,   -- 32-char hex trace ID (W3C Trace Context format)
    project_id  UUID,
    version     UInt64,   -- Unix milliseconds. ReplacingMergeTree keeps the highest.

    -- Metadata — set on trace.start(), unchanged on trace.end()
    name        String,
    start_time  DateTime64(3, 'UTC'),

    -- Set on trace.end() — zero/empty in the version=1 row
    end_time       DateTime64(3, 'UTC') DEFAULT toDateTime64(0, 3, 'UTC'),
    status         LowCardinality(String) DEFAULT 'ok', -- 'ok' | 'error'
    status_message String DEFAULT '',
    input          String DEFAULT '', -- JSON: initial input to the trace
    output         String DEFAULT '', -- JSON: final output of the trace

    -- Resource attributes for filtering traces
    -- These are indexed via the ORDER BY key — keep cardinality reasonable.
    -- user_id / session_id are arbitrary strings from the SDK caller.
    user_id     String DEFAULT '',
    session_id  String DEFAULT '',
    environment LowCardinality(String) DEFAULT '', -- 'production' | 'staging' | ...

    -- Arbitrary key-value pairs for any extra filtering needs.
    -- Query: WHERE tags['key'] = 'value'
    tags Map(String, String) DEFAULT map()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(start_time)
ORDER BY (project_id, id);

-- ============================================================
-- spans
-- ============================================================
-- Append-only. One row inserted per span when span.end() is
-- called by the SDK. Rows are never updated or deleted.
--
-- ORDER BY (project_id, trace_id, start_time, id):
--   - Fetching all spans for a trace is a sequential range scan
--     on (project_id, trace_id) — no secondary index needed.
--   - Spans within a trace are physically sorted by start_time,
--     so tree reconstruction reads data in causal order.
--   - id is appended to the key to ensure uniqueness when two
--     spans start at the same millisecond.
--
-- LLM-specific columns (model, tokens, cost) are zero/empty
-- for non-LLM span types. There is no separate table per type —
-- a single wide table is simpler to query and works well in CH.
--
-- Costs are stored as UInt64 micro-dollars.
-- See schema design note #4 above.
-- ============================================================

CREATE TABLE IF NOT EXISTS breadcrumb.spans
(
    -- Identity / tree structure
    id             String,        -- 16-char hex span ID (W3C Trace Context format)
    trace_id       String,
    parent_span_id String DEFAULT '', -- Empty string means this is a root span
    project_id     UUID,

    -- Classification
    name String,
    type LowCardinality(String), -- 'llm' | 'tool' | 'retrieval' | 'chain' | 'custom'

    -- Timing
    start_time DateTime64(3, 'UTC'),
    end_time   DateTime64(3, 'UTC'),

    -- Status
    status         LowCardinality(String) DEFAULT 'ok', -- 'ok' | 'error'
    status_message String DEFAULT '',

    -- Input / output (always JSON strings)
    -- llm spans:    input = messages array, output = completion
    -- tool spans:   input = tool arguments, output = tool result
    -- other spans:  input/output = arbitrary JSON
    input  String DEFAULT '',
    output String DEFAULT '',

    -- LLM-specific fields (zero/empty for non-LLM spans)
    provider LowCardinality(String) DEFAULT '', -- 'openai' | 'anthropic' | 'google' | ...
    model    LowCardinality(String) DEFAULT '', -- 'gpt-4o' | 'claude-3-5-sonnet-...' | ...
    input_tokens  UInt32 DEFAULT 0,
    output_tokens UInt32 DEFAULT 0,

    -- Micro-dollars: 1 USD = 1_000_000. Divide by 1_000_000 at display time.
    -- Stored as UInt64 to avoid Float64 precision loss when summing many spans.
    input_cost_usd  UInt64 DEFAULT 0,
    output_cost_usd UInt64 DEFAULT 0,

    -- Arbitrary key-value metadata from the SDK caller
    metadata Map(String, String) DEFAULT map()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(start_time)
ORDER BY (project_id, trace_id, start_time, id);

-- ============================================================
-- trace_rollups
-- ============================================================
-- Accumulated token and cost totals per trace.
-- Populated automatically by spans_to_rollups (below) —
-- never written to directly by application code.
--
-- SummingMergeTree merges rows with the same ORDER BY key
-- (project_id, trace_id) in the background, summing all
-- numeric columns. This reduces scan size over time but
-- the merge is NOT guaranteed to have happened at read time.
--
-- ALWAYS query with explicit GROUP BY + sum():
--
--   SELECT
--     trace_id,
--     sum(input_tokens)                     AS input_tokens,
--     sum(output_tokens)                    AS output_tokens,
--     sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
--     sum(span_count)                       AS span_count
--   FROM breadcrumb.trace_rollups
--   WHERE project_id = ?
--   GROUP BY trace_id
--
-- Do not use FINAL — same reasons as for traces above.
-- ============================================================

CREATE TABLE IF NOT EXISTS breadcrumb.trace_rollups
(
    project_id      UUID,
    trace_id        String,
    input_tokens    UInt64 DEFAULT 0,
    output_tokens   UInt64 DEFAULT 0,
    input_cost_usd  UInt64 DEFAULT 0,
    output_cost_usd UInt64 DEFAULT 0,
    span_count      UInt32 DEFAULT 0
)
ENGINE = SummingMergeTree()
-- No time-based partitioning: this table has at most one row per trace
-- and is always queried by (project_id, trace_id). Small and fast.
PARTITION BY tuple()
ORDER BY (project_id, trace_id);

-- ============================================================
-- spans_to_rollups (materialized view)
-- ============================================================
-- Fires on every INSERT into breadcrumb.spans.
-- Extracts the cost/token fields from each new span row and
-- inserts them into trace_rollups, where SummingMergeTree
-- accumulates them.
--
-- Does NOT fire on UPDATE or DELETE — we never do either,
-- so this is safe. If spans ever need to be corrected or
-- backfilled, trace_rollups must be rebuilt manually.
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS breadcrumb.spans_to_rollups
TO breadcrumb.trace_rollups AS
SELECT
    project_id,
    trace_id,
    input_tokens,
    output_tokens,
    input_cost_usd,
    output_cost_usd,
    1 AS span_count
FROM breadcrumb.spans;
