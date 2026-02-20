import type { TraceId, SpanId } from "./types.js";

/**
 * Generates a W3C-compliant 128-bit trace ID: 32 lowercase hex characters.
 * Uses crypto.randomUUID() which is available in Node.js >= 14.17 and all
 * modern browsers.
 */
export function generateTraceId(): TraceId {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Generates a W3C-compliant 64-bit span ID: 16 lowercase hex characters.
 */
export function generateSpanId(): SpanId {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
