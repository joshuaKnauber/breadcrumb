import type { SpanKind, SpanRecord } from "./db/types.js";

export interface SpanAttrs {
  kind?: SpanKind;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface TraceAttrs {
  userId?: string;
  sessionId?: string;
  environment?: string;
  metadata?: Record<string, unknown>;
}

export interface SpanContext {
  /** Attach/override attributes on the current span (tokens, model, io, ...). */
  set(attrs: SpanAttrs): void;
  /** Run a nested child span. A thrown error marks the span failed and rethrows. */
  span<T>(name: string, fn: (s: SpanContext) => T | Promise<T>): Promise<T>;
  span<T>(name: string, attrs: SpanAttrs, fn: (s: SpanContext) => T | Promise<T>): Promise<T>;
}

export type TraceFn = {
  <T>(name: string, fn: (t: SpanContext) => T | Promise<T>): Promise<T>;
  <T>(name: string, attrs: TraceAttrs, fn: (t: SpanContext) => T | Promise<T>): Promise<T>;
};

interface TracerDeps {
  environment: string;
  write(spans: SpanRecord[]): Promise<void>;
  onError?(error: unknown): void;
}

function newId(): string {
  return crypto.randomUUID();
}

export function createTracer(deps: TracerDeps): TraceFn {
  async function runSpan<T>(
    collected: SpanRecord[],
    traceId: string,
    parentSpanId: string | null,
    trace: Pick<TraceAttrs, "userId" | "sessionId" | "environment">,
    name: string,
    attrs: SpanAttrs,
    fn: (s: SpanContext) => T | Promise<T>
  ): Promise<T> {
    const record: SpanRecord = {
      id: newId(),
      traceId,
      parentSpanId,
      name,
      kind: attrs.kind ?? "span",
      environment: trace.environment ?? deps.environment,
      userId: trace.userId ?? null,
      sessionId: trace.sessionId ?? null,
      status: "ok",
      startTime: Date.now(),
      ...spanFields(attrs),
    };
    collected.push(record);

    const ctx: SpanContext = {
      set(next) {
        Object.assign(record, spanFields(next));
        if (next.kind) record.kind = next.kind;
      },
      span(childName: string, attrsOrFn: any, maybeFn?: any) {
        const childAttrs: SpanAttrs = typeof attrsOrFn === "function" ? {} : attrsOrFn;
        const childFn = typeof attrsOrFn === "function" ? attrsOrFn : maybeFn;
        return runSpan(collected, traceId, record.id, trace, childName, childAttrs, childFn);
      },
    };

    try {
      return await fn(ctx);
    } catch (error) {
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      record.endTime = Date.now();
    }
  }

  return async function trace(name: string, attrsOrFn: any, maybeFn?: any) {
    const attrs: TraceAttrs = typeof attrsOrFn === "function" ? {} : attrsOrFn;
    const fn = typeof attrsOrFn === "function" ? attrsOrFn : maybeFn;
    const collected: SpanRecord[] = [];
    const traceId = newId();

    try {
      return await runSpan(collected, traceId, null, attrs, name, { metadata: attrs.metadata }, fn);
    } finally {
      try {
        await deps.write(collected);
      } catch (error) {
        // Tracing must never take the host app down with it.
        (deps.onError ?? ((e) => console.error("[breadcrumb] failed to write trace:", e)))(error);
      }
    }
  } as TraceFn;
}

function spanFields(attrs: SpanAttrs): Partial<SpanRecord> {
  const out: Partial<SpanRecord> = {};
  if (attrs.model !== undefined) out.model = attrs.model;
  if (attrs.provider !== undefined) out.provider = attrs.provider;
  if (attrs.inputTokens !== undefined) out.inputTokens = attrs.inputTokens;
  if (attrs.outputTokens !== undefined) out.outputTokens = attrs.outputTokens;
  if (attrs.cost !== undefined) out.cost = attrs.cost;
  if (attrs.input !== undefined) out.input = attrs.input;
  if (attrs.output !== undefined) out.output = attrs.output;
  if (attrs.metadata !== undefined) out.metadata = attrs.metadata;
  return out;
}
