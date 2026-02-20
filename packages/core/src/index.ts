export type {
  TraceId,
  SpanId,
  SpanType,
  Status,
  TracePayload,
  SpanPayload,
} from "./types.js";

export { generateTraceId, generateSpanId } from "./ids.js";

export { IngestClient } from "./client.js";
export type { IngestClientOptions } from "./client.js";
