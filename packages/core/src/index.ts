import type {
  DatabaseAdapter,
  ListTracesOptions,
  RunSummary,
  SessionSummary,
  SpanRecord,
  TraceSummary,
} from "./db/types.js";
import {
  createTelemetryPipeline,
  type TelemetryOptions,
  type TelemetrySettings,
} from "./otel/pipeline.js";
import { createSweeper, type RetentionOptions } from "./retention.js";
import { createHandler, type AuthorizeFn } from "./router.js";
import { createTraceFn, type TraceFn } from "./trace.js";

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
}

export interface Breadcrumb {
  /** Fetch-native handler: mount it, wrapped in your own auth. */
  handler: (request: Request) => Promise<Response>;
  /** Manual tracing: bc.trace("name", { userId }, async (t) => { ... t.span(...) }) */
  trace: TraceFn;
  /** Preconfigured experimental_telemetry settings for the Vercel AI SDK. */
  telemetry: (options?: TelemetryOptions) => TelemetrySettings;
  /** Flush buffered spans (serverless: call before the runtime freezes). */
  flush: () => Promise<void>;
  /** Programmatic queries + ingest, callable server-side without HTTP. */
  api: {
    listTraces(options?: ListTracesOptions): Promise<TraceSummary[]>;
    listSessions(options?: ListTracesOptions): Promise<SessionSummary[]>;
    listRuns(options: { sessionKey: string }): Promise<RunSummary[]>;
    getTrace(options: { id: string }): Promise<SpanRecord[]>;
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

  // Lazy one-time migrate before the first DB operation.
  let readyPromise: Promise<void> | null = null;
  const ready = () => (readyPromise ??= adapter.migrate().then(() => undefined));

  const sweeper = createSweeper(adapter, options.retention);

  const api: Breadcrumb["api"] = {
    async listTraces(opts = {}) {
      await ready();
      return adapter.listTraces(opts);
    },
    async listSessions(opts = {}) {
      await ready();
      return adapter.listSessions(opts);
    },
    async listRuns({ sessionKey }) {
      await ready();
      return adapter.listRuns(sessionKey);
    },
    async getTrace({ id }) {
      await ready();
      return adapter.getTraceSpans(id);
    },
    async ingestSpans({ spans }) {
      await ready();
      await adapter.insertSpans(spans);
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
  });
  const trace = createTraceFn(pipeline.tracer);

  const handler = createHandler({
    basePath,
    environment,
    ingestApiKey: options.ingest?.apiKey,
    authorize: options.authorize,
    adapter,
    ready,
  });

  return {
    handler,
    trace,
    telemetry: pipeline.telemetry,
    flush: pipeline.flush,
    api,
    options: { ...options, basePath, environment },
  };
}

export type {
  DatabaseAdapter,
  ListTracesOptions,
  RunSummary,
  SessionSummary,
  SpanRecord,
  TraceSummary,
  SpanKind,
  SpanStatus,
} from "./db/types.js";
export type { SpanAttrs, SpanContext, TraceAttrs, TraceFn } from "./trace.js";
export type { TelemetryOptions, TelemetrySettings } from "./otel/pipeline.js";
export type { RetentionOptions } from "./retention.js";
export type { MigrationResult, RetentionRule } from "./db/types.js";
export type { AuthorizeFn } from "./router.js";
