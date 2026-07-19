import type { DatabaseAdapter, ListTracesOptions, SpanRecord, TraceSummary } from "./db/types.js";
import { createHandler } from "./router.js";
import { createTracer, type TraceFn } from "./trace.js";

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
}

export interface Breadcrumb {
  /** Fetch-native handler: mount it, wrapped in your own auth. */
  handler: (request: Request) => Promise<Response>;
  /** Manual tracing: bc.trace("name", { userId }, async (t) => { ... t.span(...) }) */
  trace: TraceFn;
  /** Programmatic queries + ingest, callable server-side without HTTP. */
  api: {
    listTraces(options?: ListTracesOptions): Promise<TraceSummary[]>;
    getTrace(options: { id: string }): Promise<SpanRecord[]>;
    ingestSpans(options: { spans: SpanRecord[] }): Promise<void>;
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
  const ready = () => (readyPromise ??= adapter.migrate());

  const api: Breadcrumb["api"] = {
    async listTraces(opts = {}) {
      await ready();
      return adapter.listTraces(opts);
    },
    async getTrace({ id }) {
      await ready();
      return adapter.getTraceSpans(id);
    },
    async ingestSpans({ spans }) {
      await ready();
      await adapter.insertSpans(spans);
    },
  };

  const trace = createTracer({
    environment,
    write: (spans) => api.ingestSpans({ spans }),
  });

  const handler = createHandler({
    basePath,
    environment,
    ingestApiKey: options.ingest?.apiKey,
    adapter,
    ready,
  });

  return {
    handler,
    trace,
    api,
    options: { ...options, basePath, environment },
  };
}

export type {
  DatabaseAdapter,
  ListTracesOptions,
  SpanRecord,
  TraceSummary,
  SpanKind,
  SpanStatus,
} from "./db/types.js";
export type { SpanAttrs, SpanContext, TraceAttrs, TraceFn } from "./trace.js";
