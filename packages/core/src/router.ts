import type { DatabaseAdapter, SpanRecord } from "./db/types.js";
import { renderAppHtml } from "./ui.js";

export interface RouterContext {
  basePath: string;
  environment: string;
  ingestApiKey: string | undefined;
  adapter: DatabaseAdapter;
  ready: () => Promise<void>;
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
    if (path === "/api/ingest/spans" && method === "POST") {
      if (!ctx.ingestApiKey) return json({ error: "not found" }, 404);
      const key = request.headers.get(INGEST_KEY_HEADER);
      if (!key || !timingSafeEqual(key, ctx.ingestApiKey)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: any;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!Array.isArray(body?.spans)) return json({ error: "expected { spans: [] }" }, 400);
      const spans = body.spans
        .map((s: unknown) => normalizeIngestedSpan(s, ctx.environment))
        .filter((s: SpanRecord | null): s is SpanRecord => s !== null);
      await ctx.ready();
      await ctx.adapter.insertSpans(spans);
      return json({ ingested: spans.length });
    }

    // --- UI/query routes: no auth here, the user wraps the mount ---
    if (method === "GET") {
      if (path === "/") {
        return new Response(renderAppHtml(basePath || "/"), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (path === "/api/traces") {
        await ctx.ready();
        const limit = Number(url.searchParams.get("limit") ?? "") || undefined;
        const environment = url.searchParams.get("environment") ?? undefined;
        const traces = await ctx.adapter.listTraces({ limit, environment });
        return json({ traces });
      }
      const traceMatch = path.match(/^\/api\/traces\/([^/]+)$/);
      if (traceMatch) {
        await ctx.ready();
        const spans = await ctx.adapter.getTraceSpans(decodeURIComponent(traceMatch[1]!));
        if (spans.length === 0) return json({ error: "not found" }, 404);
        return json({ spans });
      }
    }

    return json({ error: "not found" }, 404);
  };
}
