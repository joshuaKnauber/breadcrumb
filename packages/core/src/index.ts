import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type {
  CostQueryOptions,
  CostSummary,
  DatabaseAdapter,
  ListOptions,
  Page,
  RunSummary,
  SessionSummary,
  SpanRecord,
  Stats,
  TraceFilter,
  TraceSummary,
} from "./db/types.js";
import { clampLimit, pageOf } from "./db/rows.js";
import { capPayload } from "./sanitize.js";
import {
  createTelemetryPipeline,
  type TelemetryOptions,
  type TelemetrySettings,
} from "./otel/pipeline.js";
import { applyPricing, resolvePricing, type Pricing } from "./pricing.js";
import { createSweeper, type RetentionOptions } from "./retention.js";
import { createHandler, type AuthorizeFn } from "./router.js";
import { createTraceFn, type TraceFn } from "./trace.js";
import { createMcpKeyStore } from "./mcp/keys.js";
import type { McpOptions } from "./mcp/config.js";

export interface BreadcrumbOptions {
  /** Database adapter, e.g. sqlite(".breadcrumb/dev.db") from @breadcrumb-sh/core/adapters */
  database: DatabaseAdapter;
  /** Where the handler is mounted, e.g. "/admin/traces". Default: "/breadcrumb" */
  basePath?: string;
  /** Stamped on every span. Default: VERCEL_ENV ?? NODE_ENV ?? "development" */
  environment?: string;
  /**
   * Enables the HTTP ingest endpoints for external services (OTLP later).
   * Omit entirely if only this app writes traces — the endpoints then 404.
   */
  ingest?: { apiKey: string };
  /**
   * Retention windows per environment. Defaults: 90d, development 7d.
   * Sweeps are bounded and piggyback on ingest — no cron needed.
   */
  retention?: RetentionOptions;
  /**
   * Guards the UI/query routes (ingest routes use the API key instead).
   * Return true to allow, false to 401, or a Response (e.g. a redirect).
   * Alternative to wrapping the mount in middleware.
   */
  authorize?: AuthorizeFn;
  /**
   * Your model prices (USD per 1M tokens), keyed by model name. When a span
   * has tokens + model but no explicit cost, breadcrumb computes it from these.
   * Omit to store only costs you set yourself — breadcrumb assumes no prices.
   */
  pricing?: Pricing;
  /**
   * Scrub PII or trim payloads before storage. Runs on every span from every
   * path (manual, AI SDK, external ingest) just before it's written. Mutate the
   * span in place, or return a replacement.
   */
  redact?: (span: SpanRecord) => SpanRecord | void;
  /**
   * Max characters kept for a span's captured input/output; longer payloads are
   * truncated with a marker so one call can't write megabytes. Default 16384;
   * set 0 to disable.
   */
  maxPayloadChars?: number;
  /**
   * "batch" (default): buffer spans and export every ~2s — best for a
   * long-running server. "sync": export each span as it ends, for serverless or
   * edge where a final flush isn't guaranteed. Either way, `await bc.flush()`
   * (or `waitUntil(bc.flush())`) before a serverless function returns.
   */
  flushMode?: "batch" | "sync";
  /**
   * Filters what `bc.spanProcessor` keeps when it's registered on a provider you
   * own. By default only spans breadcrumb can read are stored (`ai.*`,
   * `gen_ai.*`, `breadcrumb.*`); return true for more to keep your own
   * instrumentation's spans alongside them.
   */
  shouldExport?: (span: ReadableSpan) => boolean;
  /**
   * "auto" (default): create/upgrade the schema on first use — great for local
   * development. "manual": never run DDL at runtime; you own migrations, applied
   * with `breadcrumb migrate` or `breadcrumb generate` plus your tooling.
   */
  migrations?: "auto" | "manual";
  /**
   * Tunes the MCP endpoint at `basePath + /api/mcp`, where a coding agent reads
   * your traces. Not a switch: the endpoint is always mounted, but it is
   * unreachable until someone mints a key from the dashboard's MCP tab, which
   * `authorize` already guards. The agent gets policy-gated read access to the
   * span table only — no other table in your database, and no writes.
   */
  mcp?: McpOptions;
}

export interface Breadcrumb {
  /** Fetch-native handler: mount it, wrapped in your own auth. */
  handler: (request: Request) => Promise<Response>;
  /** Manual tracing: bc.trace("name", { userId }, async (t) => { ... t.span(...) }) */
  trace: TraceFn;
  /** Preconfigured experimental_telemetry settings for the Vercel AI SDK. */
  telemetry: (options?: TelemetryOptions) => TelemetrySettings;
  /**
   * An OpenTelemetry span processor for apps that already own a TracerProvider
   * (@vercel/otel, NodeSDK, Sentry). Register it and model spans reach breadcrumb
   * without threading `bc.telemetry()` through every call.
   */
  readonly spanProcessor: SpanProcessor;
  /** Flush buffered spans (serverless: call before the runtime freezes). */
  flush: () => Promise<void>;
  /**
   * Programmatic queries + ingest, callable server-side without HTTP — the
   * headless surface for building a custom admin UI over your own data.
   */
  api: {
    /** Traces (one per run), newest first, filtered + keyset-paginated. */
    listTraces(options?: ListOptions): Promise<Page<TraceSummary>>;
    /** Sessions (traces grouped by sessionId), by last activity, paginated. */
    listSessions(options?: ListOptions): Promise<Page<SessionSummary>>;
    listRuns(options: { sessionKey: string }): Promise<RunSummary[]>;
    getTrace(options: { id: string }): Promise<SpanRecord[]>;
    getSpan(options: { id: string }): Promise<SpanRecord | null>;
    listEnvironments(): Promise<string[]>;
    costSummary(options?: CostQueryOptions): Promise<CostSummary>;
    /** Headline numbers (runs, error rate, cost, latency) over a filter. */
    stats(options?: TraceFilter): Promise<Stats>;
    ingestSpans(options: { spans: SpanRecord[] }): Promise<void>;
    /** One bounded retention batch (for cron/manual sweeping); returns rows deleted. */
    runRetention(): Promise<number>;
  };
  options: Required<Pick<BreadcrumbOptions, "basePath" | "environment">> & BreadcrumbOptions;
}

export function breadcrumb(options: BreadcrumbOptions): Breadcrumb {
  const environment =
    options.environment ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    "development";
  const basePath = options.basePath ?? "/breadcrumb";
  const adapter = options.database;
  const pricing = resolvePricing(options.pricing);
  const redact = options.redact;
  const maxPayloadChars = options.maxPayloadChars ?? 16384;

  // Lazy one-time migrate before the first DB operation, unless the app owns
  // migrations ("manual") — then no DDL ever runs at runtime.
  const autoMigrate = (options.migrations ?? "auto") === "auto";
  let readyPromise: Promise<void> | null = null;
  const ready = () =>
    (readyPromise ??= autoMigrate ? adapter.migrate().then(() => undefined) : Promise.resolve());

  const sweeper = createSweeper(adapter, options.retention);

  const api: Breadcrumb["api"] = {
    async listTraces(opts = {}) {
      await ready();
      const items = await adapter.listTraces(opts);
      return pageOf(items, clampLimit(opts.limit), (t) => t.startTime, (t) => t.traceId);
    },
    async listSessions(opts = {}) {
      await ready();
      const items = await adapter.listSessions(opts);
      return pageOf(items, clampLimit(opts.limit), (s) => s.endTime ?? s.startTime, (s) => s.sessionKey);
    },
    async listRuns({ sessionKey }) {
      await ready();
      return adapter.listRuns(sessionKey);
    },
    async getTrace({ id }) {
      await ready();
      return adapter.getTraceSpans(id);
    },
    async getSpan({ id }) {
      await ready();
      return adapter.getSpan(id);
    },
    async listEnvironments() {
      await ready();
      return adapter.listEnvironments();
    },
    async costSummary(opts = {}) {
      await ready();
      return adapter.costSummary(opts);
    },
    async stats(opts = {}) {
      await ready();
      return adapter.stats(opts);
    },
    async ingestSpans({ spans }) {
      await ready();
      // Single write funnel: redact (user) → cap payloads → price, for every path.
      const list = redact ? spans.map((s) => redact(s) ?? s) : spans;
      for (const span of list) {
        if (maxPayloadChars > 0) {
          span.input = capPayload(span.input, maxPayloadChars);
          span.output = capPayload(span.output, maxPayloadChars);
        }
        applyPricing(span, pricing);
      }
      await adapter.insertSpans(list);
      await sweeper.maybeSweep();
    },
    async runRetention() {
      await ready();
      return sweeper.run();
    },
  };

  const pipeline = createTelemetryPipeline({
    environment,
    write: (spans) => api.ingestSpans({ spans }),
    flushMode: options.flushMode,
    shouldExport: options.shouldExport,
  });
  const trace = createTraceFn(pipeline.tracer);

  const mcpKeys = createMcpKeyStore(adapter, ready);
  const mcpOptions = options.mcp ?? {};

  // valv and the MCP SDK are only pulled in when an agent actually connects, so
  // apps that never open the MCP tab don't pay for loading them.
  let mcpHandlerPromise: Promise<(request: Request) => Promise<Response>> | null = null;
  const mcpHandler = () =>
    (mcpHandlerPromise ??= (async () => {
      const { createTraceValv, createMcpHandler } = await import("./mcp/server.js");
      await ready();
      return createMcpHandler(await createTraceValv(adapter, mcpOptions), mcpOptions);
    })());

  const handler = createHandler({
    basePath,
    environment,
    ingestApiKey: options.ingest?.apiKey,
    authorize: options.authorize,
    adapter,
    ready,
    ingest: (spans) => api.ingestSpans({ spans }),
    mcpKeys,
    mcp: mcpOptions,
    mcpHandler,
  });

  return {
    handler,
    trace,
    telemetry: pipeline.telemetry,
    get spanProcessor() {
      return pipeline.spanProcessor;
    },
    flush: pipeline.flush,
    api,
    options: { ...options, basePath, environment },
  };
}

export type {
  CostQueryOptions,
  CostSummary,
  CostDatum,
  CostGroup,
  DatabaseAdapter,
  ListOptions,
  ListTracesOptions,
  Page,
  Stats,
  TraceFilter,
  RunSummary,
  SessionSummary,
  SpanRecord,
  TraceSummary,
  SpanKind,
  SpanStatus,
} from "./db/types.js";
export type { Pricing, PricingTable, ModelPrice } from "./pricing.js";
export type { SpanAttrs, SpanContext, TraceAttrs, TraceFn } from "./trace.js";
export type { TelemetryOptions, TelemetrySettings } from "./otel/pipeline.js";
export type { RetentionOptions } from "./retention.js";
export type { MigrationResult, MigrationPlan, SchemaState, Dialect, RetentionRule } from "./db/types.js";
export type { AuthorizeFn } from "./router.js";
export { planMigration, renderMigrationSql, EMPTY_SCHEMA_STATE } from "./db/ddl.js";
