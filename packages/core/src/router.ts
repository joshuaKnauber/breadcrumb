import type { DatabaseAdapter, ListOptions, SpanRecord, TraceFilter } from "./db/types.js";
import { clampLimit, pageOf } from "./db/rows.js";
import { normalizeSpanData } from "./otel/normalize.js";
import { parseOtlpJson } from "./otel/otlp.js";
import { renderApp } from "./ui.js";
import { readBearerToken, type McpKeyStore } from "./mcp/keys.js";
import { resolveMcpServerName, type McpOptions } from "./mcp/config.js";

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
  /** MCP key storage, backing both the agent endpoint and the dashboard tab. */
  mcpKeys: McpKeyStore;
  mcp: McpOptions;
  /** Lazily built so valv is only loaded when an agent actually connects. */
  mcpHandler: () => Promise<(request: Request) => Promise<Response>>;
}

const INGEST_KEY_HEADER = "x-breadcrumb-key";

/** Shared query-string → TraceFilter parsing for list + stats routes. */
function parseFilter(p: URLSearchParams): TraceFilter {
  const numParam = (key: string): number | undefined => {
    const raw = p.get(key);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const status = p.get("status");
  return {
    environment: p.get("environment") ?? undefined,
    userId: p.get("userId") ?? undefined,
    model: p.get("model") ?? undefined,
    status: status === "error" ? "error" : status === "ok" ? "ok" : undefined,
    since: numParam("since"),
    until: numParam("until"),
  };
}

function parseListOptions(p: URLSearchParams): ListOptions {
  return {
    ...parseFilter(p),
    limit: Number(p.get("limit") ?? "") || undefined,
    cursor: p.get("cursor") ?? undefined,
  };
}

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

    // --- MCP: bearer-key auth, like ingest, so a coding agent reaches it
    //     without going through the dashboard's browser-session `authorize` ---
    if (path === "/api/mcp") {
      const token = readBearerToken(request);
      if (!token) {
        // Advertise the scheme so a client knows what to present rather than
        // guessing it hit the wrong endpoint.
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
        });
      }
      const key = await ctx.mcpKeys.resolve(token);
      if (!key) return json({ error: "unauthorized" }, 401);
      const handle = await ctx.mcpHandler();
      return handle(request);
    }

    // --- UI/query routes: wrapped by the user's middleware and/or `authorize` ---
    if (ctx.authorize) {
      const verdict = await ctx.authorize(request);
      if (verdict instanceof Response) return verdict;
      if (verdict !== true) return json({ error: "unauthorized" }, 401);
    }
    // MCP key management. Guarded by `authorize` above, so whoever can already
    // read traces in the dashboard can mint a key that reads the same data.
    if (path === "/api/mcp-keys") {
      if (method === "GET") {
        // serverName rides along so the dashboard's connect snippets name the
        // server exactly as it identifies itself, including the loopback default.
        return json({
          keys: await ctx.mcpKeys.list(),
          serverName: resolveMcpServerName(ctx.mcp, request),
        });
      }
      if (method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name) return json({ error: "expected { name: string }" }, 400);
        if (name.length > 255) return json({ error: "name too long" }, 400);
        const { record, token } = await ctx.mcpKeys.create(name);
        // The only time the raw token is ever returned — it is stored hashed.
        return json({ key: record, token }, 201);
      }
    }
    const keyMatch = path.match(/^\/api\/mcp-keys\/([^/]+)$/);
    if (keyMatch && method === "DELETE") {
      const revoked = await ctx.mcpKeys.revoke(decodeURIComponent(keyMatch[1]!));
      if (!revoked) return json({ error: "not found" }, 404);
      return json({ revoked: true });
    }

    if (method === "GET") {
      if (path === "/api/traces") {
        await ctx.ready();
        const opts = parseListOptions(url.searchParams);
        const items = await ctx.adapter.listTraces(opts);
        return json(pageOf(items, clampLimit(opts.limit), (t) => t.startTime, (t) => t.traceId));
      }
      if (path === "/api/sessions") {
        await ctx.ready();
        const opts = parseListOptions(url.searchParams);
        const items = await ctx.adapter.listSessions(opts);
        return json(pageOf(items, clampLimit(opts.limit), (s) => s.endTime ?? s.startTime, (s) => s.sessionKey));
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
      if (path === "/api/stats") {
        await ctx.ready();
        const stats = await ctx.adapter.stats(parseFilter(url.searchParams));
        return json(stats);
      }
      if (path === "/api/cost") {
        await ctx.ready();
        const days = Number(url.searchParams.get("days") ?? "") || undefined;
        const environment = url.searchParams.get("environment") ?? undefined;
        const cost = await ctx.adapter.costSummary({ days, environment });
        return json(cost);
      }
      const spanMatch = path.match(/^\/api\/spans\/([^/]+)$/);
      if (spanMatch) {
        await ctx.ready();
        const span = await ctx.adapter.getSpan(decodeURIComponent(spanMatch[1]!));
        if (!span) return json({ error: "not found" }, 404);
        return json({ span });
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
