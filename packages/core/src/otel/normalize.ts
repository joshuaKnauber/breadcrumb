import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SpanKind, SpanRecord } from "../db/types.js";

/**
 * Neutral span shape both ingestion paths produce:
 * - the in-process exporter (ReadableSpan)
 * - the OTLP/HTTP endpoint (protobuf-JSON)
 * normalizeSpanData maps it into breadcrumb's span model, understanding three
 * attribute dialects: breadcrumb.*, ai.* (Vercel AI SDK), gen_ai.* (OTel GenAI).
 */
export interface OtelSpanData {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  attributes: Record<string, unknown>;
  startMs: number;
  endMs: number | null;
  /** null = ok; a string (possibly empty) = error status with message */
  error: string | null;
  /** From resource attributes (deployment.environment.name); overrides the default. */
  environment?: string;
}

type Attrs = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
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
  const op = str(attrs["ai.operationId"]) ?? str(attrs["gen_ai.operation.name"]) ?? name;
  if (op.includes("toolCall") || op.startsWith("execute_tool")) return "tool";
  if (op.includes("embed") || op.startsWith("embeddings")) return "embedding";
  if (op.startsWith("retrieval")) return "retrieval";
  if (
    op.includes("doGenerate") ||
    op.includes("doStream") ||
    op.startsWith("chat") ||
    op.startsWith("text_completion") ||
    op.startsWith("generate_content") ||
    attrs["gen_ai.request.model"] !== undefined
  ) {
    return "llm";
  }
  if (op.startsWith("invoke_agent") || op.startsWith("create_agent")) return "agent";
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

export function normalizeSpanData(data: OtelSpanData, defaultEnvironment: string): SpanRecord {
  const attrs = data.attributes;
  const isError = data.error !== null;

  const name = !data.parentSpanId
    ? (str(attrs["ai.telemetry.functionId"]) ?? data.name)
    : data.name;

  const kind = inferKind(data.name, attrs);
  // The AI SDK mirrors usage onto both the outer ai.generateText span and the
  // inner doGenerate span — count it only once, on the actual LLM span.
  const aiWrapperSpan = attrs["ai.operationId"] !== undefined && kind !== "llm";

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

  return {
    id: data.spanId,
    traceId: data.traceId,
    parentSpanId: data.parentSpanId,
    name,
    kind,
    environment: data.environment ?? defaultEnvironment,
    userId: first(
      str(attrs["breadcrumb.userId"]),
      str(attrs["ai.telemetry.metadata.userId"]),
      str(attrs["user.id"])
    ),
    sessionId: first(
      str(attrs["breadcrumb.sessionId"]),
      str(attrs["ai.telemetry.metadata.sessionId"]),
      str(attrs["gen_ai.conversation.id"]),
      str(attrs["session.id"])
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
    error: isError ? (data.error || "error") : null,
    input: input ?? undefined,
    output: output ?? undefined,
    metadata: collectMetadata(attrs),
    startTime: data.startMs,
    endTime: data.endMs,
  };
}

function hrToMs(time: [number, number]): number {
  return time[0] * 1000 + Math.round(time[1] / 1e6);
}

export function fromReadableSpan(span: ReadableSpan): OtelSpanData {
  const ctx = span.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId:
      (span as { parentSpanContext?: { spanId?: string } }).parentSpanContext?.spanId ??
      (span as { parentSpanId?: string }).parentSpanId ??
      null,
    name: span.name,
    attributes: span.attributes as Attrs,
    startMs: hrToMs(span.startTime),
    endMs: hrToMs(span.endTime),
    error: span.status.code === SpanStatusCode.ERROR ? (span.status.message ?? "") : null,
  };
}
