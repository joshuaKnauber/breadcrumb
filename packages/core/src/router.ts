import type { DatabaseAdapter, SpanRecord } from "./db/types.js";
import { normalizeSpanData } from "./otel/normalize.js";
import { parseOtlpJson } from "./otel/otlp.js";
import { renderApp } from "./ui.js";

export type AuthorizeFn = (
  request: Request
) => boolean | Response | undefined | null | Promise<boolean | Response | undefined | null>;

export interface RouterContext {
  basePath: string;
  environment: string;
  ingestApiKey: string | undefined;
  /** Guards UI/query routes only — ingest routes use the API key. */
  authorize?: AuthorizeFn;
  adapter: DatabaseAdapter;
  ready: () => Promise<void>;
  /** Single write funnel (applies pricing, sweeps). Used by all ingest routes. */
  ingest: (spans: SpanRecord[]) => Promise<void>;
}

const INGEST_KEY_HEADER = "x-breadcrumb-key";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Coerce an ingested payload span into a SpanRecord, stamping defaults. */
export function normalizeIngestedSpan(raw: any, environment: string): SpanRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (typeof raw.traceId !== "string" || typeof raw.name !== "string") return null;
  const startTime = typeof raw.startTime === "number" ? raw.startTime : Date.now();
  return {
    id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
    traceId: raw.traceId,
    parentSpanId: typeof raw.parentSpanId === "string" ? raw.parentSpanId : null,
    name: raw.name,
    kind: typeof raw.kind === "string" ? raw.kind : "span",
    environment: typeof raw.environment === "string" ? raw.environment : environment,
    userId: typeof raw.userId === "string" ? raw.userId : null,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    model: typeof raw.model === "string" ? raw.model : null,
    provider: typeof raw.provider === "string" ? raw.provider : null,
    inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : null,
    outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : null,
    cachedInputTokens: typeof raw.cachedInputTokens === "number" ? raw.cachedInputTokens : null,
    cacheWriteTokens: typeof raw.cacheWriteTokens === "number" ? raw.cacheWriteTokens : null,
    reasoningTokens: typeof raw.reasoningTokens === "number" ? raw.reasoningTokens : null,
    cost: typeof raw.cost === "number" ? raw.cost : null,
    status: raw.status === "error" ? "error" : "ok",
    error: typeof raw.error === "string" ? raw.error : null,
    input: raw.input,
    output: raw.output,
    metadata: typeof raw.metadata === "object" ? raw.metadata : null,
    startTime,
    endTime: typeof raw.endTime === "number" ? raw.endTime : null,
  };
}

export function createHandler(ctx: RouterContext): (request: Request) => Promise<Response> {
  const basePath = ctx.basePath === "/" ? "" : ctx.basePath.replace(/\/$/, "");

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let path: string;
    if (url.pathname === basePath || url.pathname === basePath + "/") {
      path = "/";
    } else if (url.pathname.startsWith(basePath + "/")) {
      path = url.pathname.slice(basePath.length);
    } else {
      return json({ error: "not found" }, 404);
    }
    const method = request.method.toUpperCase();

    // --- ingest routes: API-key auth, meant to sit OUTSIDE the user's UI auth ---
    if (path.startsWith("/api/ingest/") && method === "POST") {
      if (!ctx.ingestApiKey) return json({ error: "not found" }, 404);
      const key =
        request.headers.get(INGEST_KEY_HEADER) ??
        request.headers.get("authorization")?.replace(/^Bearer /, "") ??
        null;
      if (!key || !timingSafeEqual(key, ctx.ingestApiKey)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: any;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }

      if (path === "/api/ingest/spans") {
        if (!Array.isArray(body?.spans)) return json({ error: "expected { spans: [] }" }, 400);
        const spans = body.spans
          .map((s: unknown) => normalizeIngestedSpan(s, ctx.environment))
          .filter((s: SpanRecord | null): s is SpanRecord => s !== null);
        await ctx.ingest(spans);
        return json({ ingested: spans.length });
      }

      // OTLP/HTTP JSON (standard exporters: OTEL_EXPORTER_OTLP_ENDPOINT + headers)
      if (path === "/api/ingest/otel" || path === "/api/ingest/otel/v1/traces") {
        const spans = parseOtlpJson(body).map((s) => normalizeSpanData(s, ctx.environment));
        await ctx.ingest(spans);
        return json({ partialSuccess: {} });
      }

      return json({ error: "not found" }, 404);
    }

    // --- UI/query routes: wrapped by the user's middleware and/or `authorize` ---
    if (ctx.authorize) {
      const verdict = await ctx.authorize(request);
      if (verdict instanceof Response) return verdict;
      if (verdict !== true) return json({ error: "unauthorized" }, 401);
    }
    if (method === "GET") {
      if (path === "/api/traces") {
        await ctx.ready();
        const limit = Number(url.searchParams.get("limit") ?? "") || undefined;
        const environment = url.searchParams.get("environment") ?? undefined;
        const traces = await ctx.adapter.listTraces({ limit, environment });
        return json({ traces });
      }
      if (path === "/api/sessions") {
        await ctx.ready();
        const limit = Number(url.searchParams.get("limit") ?? "") || undefined;
        const environment = url.searchParams.get("environment") ?? undefined;
        const sessions = await ctx.adapter.listSessions({ limit, environment });
        return json({ sessions });
      }
      const runsMatch = path.match(/^\/api\/sessions\/([^/]+)\/runs$/);
      if (runsMatch) {
        await ctx.ready();
        const runs = await ctx.adapter.listRuns(decodeURIComponent(runsMatch[1]!));
        return json({ runs });
      }
      if (path === "/api/environments") {
        await ctx.ready();
        const environments = await ctx.adapter.listEnvironments();
        return json({ environments });
      }
      if (path === "/api/cost") {
        await ctx.ready();
        const days = Number(url.searchParams.get("days") ?? "") || undefined;
        const environment = url.searchParams.get("environment") ?? undefined;
        const cost = await ctx.adapter.costSummary({ days, environment });
        return json(cost);
      }
      const traceMatch = path.match(/^\/api\/traces\/([^/]+)$/);
      if (traceMatch) {
        await ctx.ready();
        const spans = await ctx.adapter.getTraceSpans(decodeURIComponent(traceMatch[1]!));
        if (spans.length === 0) return json({ error: "not found" }, 404);
        return json({ spans });
      }
      // SPA fallback: any non-API GET serves the app, so client-side routes
      // (/cost, /failures) survive a hard refresh / deep link.
      if (!path.startsWith("/api/")) {
        return new Response(renderApp(basePath || "/"), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    }

    return json({ error: "not found" }, 404);
  };
}
