export { Breadcrumb } from "./breadcrumb.js";
export { TraceHandle } from "./trace.js";
export { SpanHandle } from "./span.js";
export type {
  TraceOptions,
  TraceEndOptions,
  SpanOptions,
  SpanEndOptions,
} from "./types.js";

// Re-export core primitives so users only need one import
export type {
  TraceId,
  SpanId,
  SpanType,
  Status,
  TracePayload,
  SpanPayload,
  IngestClientOptions,
} from "@breadcrumb/core";
export { generateTraceId, generateSpanId, IngestClient } from "@breadcrumb/core";
