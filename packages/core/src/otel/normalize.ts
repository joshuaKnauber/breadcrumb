import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SpanKind, SpanRecord } from "../db/types.js";

/**
 * Maps OTel spans into breadcrumb's span model. Understands three dialects:
 * - breadcrumb.* (our own tracer)
 * - ai.*         (Vercel AI SDK experimental_telemetry)
 * - gen_ai.*     (OTel GenAI semantic conventions)
 */

type Attrs = Record<string, unknown>;

function hrToMs(time: [number, number]): number {
  return time[0] * 1000 + Math.round(time[1] / 1e6);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function first<T>(...values: (T | null | undefined)[]): T | null {
  for (const v of values) if (v !== null && v !== undefined) return v;
  return null;
}

function inferKind(name: string, attrs: Attrs): SpanKind {
  const explicit = str(attrs["breadcrumb.kind"]);
  if (explicit) return explicit as SpanKind;
  const op = str(attrs["ai.operationId"]) ?? name;
  if (op.includes("toolCall") || op.startsWith("execute_tool")) return "tool";
  if (op.includes("embed") || op.startsWith("embeddings")) return "embedding";
  if (
    op.includes("doGenerate") ||
    op.includes("doStream") ||
    op.startsWith("chat") ||
    op.startsWith("text_completion") ||
    attrs["gen_ai.request.model"] !== undefined
  ) {
    return "llm";
  }
  if (op.startsWith("invoke_agent")) return "agent";
  return "span";
}

function collectMetadata(attrs: Attrs): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const fromBc = parseMaybeJson(attrs["breadcrumb.metadata"]);
  if (fromBc && typeof fromBc === "object") Object.assign(out, fromBc);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("ai.telemetry.metadata.")) {
      out[key.slice("ai.telemetry.metadata.".length)] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function normalizeOtelSpan(span: ReadableSpan, environment: string): SpanRecord {
  const attrs = span.attributes as Attrs;
  const ctx = span.spanContext();
  const parentSpanId =
    (span as { parentSpanContext?: { spanId?: string } }).parentSpanContext?.spanId ??
    (span as { parentSpanId?: string }).parentSpanId ??
    null;

  const metadata = collectMetadata(attrs);
  const isError = span.status.code === SpanStatusCode.ERROR;

  const name = !parentSpanId
    ? (str(attrs["ai.telemetry.functionId"]) ?? span.name)
    : span.name;

  const input = first(
    parseMaybeJson(attrs["breadcrumb.input"]),
    parseMaybeJson(attrs["ai.prompt.messages"]),
    parseMaybeJson(attrs["ai.prompt"]),
    parseMaybeJson(attrs["ai.toolCall.args"]),
    parseMaybeJson(attrs["gen_ai.input.messages"])
  );
  const output = first(
    parseMaybeJson(attrs["breadcrumb.output"]),
    str(attrs["ai.response.text"]),
    parseMaybeJson(attrs["ai.response.toolCalls"]),
    parseMaybeJson(attrs["ai.response.object"]),
    parseMaybeJson(attrs["ai.toolCall.result"]),
    parseMaybeJson(attrs["gen_ai.output.messages"])
  );

  const kind = inferKind(span.name, attrs);
  // The AI SDK mirrors usage onto both the outer ai.generateText span and the
  // inner doGenerate span — count it only once, on the actual LLM span.
  const aiWrapperSpan = attrs["ai.operationId"] !== undefined && kind !== "llm";

  return {
    id: ctx.spanId,
    traceId: ctx.traceId,
    parentSpanId,
    name,
    kind,
    environment,
    userId: first(
      str(attrs["breadcrumb.userId"]),
      str(attrs["ai.telemetry.metadata.userId"])
    ),
    sessionId: first(
      str(attrs["breadcrumb.sessionId"]),
      str(attrs["ai.telemetry.metadata.sessionId"]),
      str(attrs["gen_ai.conversation.id"])
    ),
    model: first(
      str(attrs["breadcrumb.model"]),
      str(attrs["ai.response.model"]),
      str(attrs["ai.model.id"]),
      str(attrs["gen_ai.response.model"]),
      str(attrs["gen_ai.request.model"])
    ),
    provider: first(
      str(attrs["breadcrumb.provider"]),
      str(attrs["ai.model.provider"]),
      str(attrs["gen_ai.provider.name"]),
      str(attrs["gen_ai.system"])
    ),
    inputTokens: first(
      num(attrs["breadcrumb.inputTokens"]),
      aiWrapperSpan
        ? null
        : first(num(attrs["ai.usage.promptTokens"]), num(attrs["ai.usage.inputTokens"])),
      num(attrs["gen_ai.usage.input_tokens"])
    ),
    outputTokens: first(
      num(attrs["breadcrumb.outputTokens"]),
      aiWrapperSpan
        ? null
        : first(num(attrs["ai.usage.completionTokens"]), num(attrs["ai.usage.outputTokens"])),
      num(attrs["gen_ai.usage.output_tokens"])
    ),
    cost: num(attrs["breadcrumb.cost"]),
    status: isError ? "error" : "ok",
    error: isError ? (span.status.message ?? "error") : null,
    input: input ?? undefined,
    output: output ?? undefined,
    metadata,
    startTime: hrToMs(span.startTime),
    endTime: hrToMs(span.endTime),
  };
}
