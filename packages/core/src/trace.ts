import { SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import type { SpanKind } from "./db/types.js";

export interface SpanAttrs {
  kind?: SpanKind;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Cache-read tokens (subset of inputTokens). */
  cachedInputTokens?: number;
  /** Cache-write tokens (subset of inputTokens). */
  cacheWriteTokens?: number;
  /** Reasoning/thinking tokens (subset of outputTokens). */
  reasoningTokens?: number;
  cost?: number;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface TraceAttrs {
  userId?: string;
  sessionId?: string;
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

function applySpanAttrs(span: Span, attrs: SpanAttrs): void {
  if (attrs.kind !== undefined) span.setAttribute("breadcrumb.kind", attrs.kind);
  if (attrs.model !== undefined) span.setAttribute("breadcrumb.model", attrs.model);
  if (attrs.provider !== undefined) span.setAttribute("breadcrumb.provider", attrs.provider);
  if (attrs.inputTokens !== undefined) span.setAttribute("breadcrumb.inputTokens", attrs.inputTokens);
  if (attrs.outputTokens !== undefined) span.setAttribute("breadcrumb.outputTokens", attrs.outputTokens);
  if (attrs.cachedInputTokens !== undefined) span.setAttribute("breadcrumb.cachedInputTokens", attrs.cachedInputTokens);
  if (attrs.cacheWriteTokens !== undefined) span.setAttribute("breadcrumb.cacheWriteTokens", attrs.cacheWriteTokens);
  if (attrs.reasoningTokens !== undefined) span.setAttribute("breadcrumb.reasoningTokens", attrs.reasoningTokens);
  if (attrs.cost !== undefined) span.setAttribute("breadcrumb.cost", attrs.cost);
  if (attrs.input !== undefined) span.setAttribute("breadcrumb.input", JSON.stringify(attrs.input));
  if (attrs.output !== undefined) span.setAttribute("breadcrumb.output", JSON.stringify(attrs.output));
  if (attrs.metadata !== undefined) span.setAttribute("breadcrumb.metadata", JSON.stringify(attrs.metadata));
}

function applyTraceAttrs(span: Span, attrs: TraceAttrs): void {
  if (attrs.userId !== undefined) span.setAttribute("breadcrumb.userId", attrs.userId);
  if (attrs.sessionId !== undefined) span.setAttribute("breadcrumb.sessionId", attrs.sessionId);
  if (attrs.metadata !== undefined) span.setAttribute("breadcrumb.metadata", JSON.stringify(attrs.metadata));
}

/**
 * Manual tracing built on the same OTel tracer as bc.telemetry(): AI SDK
 * calls made inside a bc.trace() callback nest into the same trace via
 * context propagation.
 */
export function createTraceFn(tracer: Tracer): TraceFn {
  function runSpan<T>(
    name: string,
    apply: (span: Span) => void,
    fn: (s: SpanContext) => T | Promise<T>
  ): Promise<T> {
    return tracer.startActiveSpan(name, async (span) => {
      apply(span);
      const ctx: SpanContext = {
        set: (next) => applySpanAttrs(span, next),
        span(childName: string, attrsOrFn: any, maybeFn?: any) {
          const childAttrs: SpanAttrs = typeof attrsOrFn === "function" ? {} : attrsOrFn;
          const childFn = typeof attrsOrFn === "function" ? attrsOrFn : maybeFn;
          return runSpan(childName, (s) => applySpanAttrs(s, childAttrs), childFn);
        },
      };
      try {
        return await fn(ctx);
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  return function trace(name: string, attrsOrFn: any, maybeFn?: any) {
    const attrs: TraceAttrs = typeof attrsOrFn === "function" ? {} : attrsOrFn;
    const fn = typeof attrsOrFn === "function" ? attrsOrFn : maybeFn;
    return runSpan(name, (span) => applyTraceAttrs(span, attrs), fn);
  } as TraceFn;
}
