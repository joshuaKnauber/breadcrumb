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

interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
}

const EMPTY_USAGE: Usage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
};

/**
 * The AI SDK mirrors usage onto wrapper spans (ai.generateText, ai.streamText,
 * ...) as a last-step or aggregate copy. The per-model-call spans — the ".do*"
 * operations (doGenerate/doStream/doEmbed) — are the only carriers that are
 * both per-call and additive across multi-step tool loops, so usage is counted
 * there and wrapper usage is ignored.
 */
function isAiUsageCarrier(operationId: string): boolean {
  return operationId.includes(".do");
}

/**
 * Token usage, normalized to the OTel GenAI convention: inputTokens is
 * cache-INCLUSIVE, and cache read/write (and reasoning within output) are
 * subsets. Emitters that report exclusive input (older gen_ai instrumentations
 * mirroring Anthropic's API) are caught by the clamp: when the subsets exceed
 * the declared total, the total is raised to the subset sum (best effort).
 */
function normalizeUsage(attrs: Attrs): Usage {
  const clampSubsets = (u: Usage): Usage => {
    const cacheSum = (u.cachedInputTokens ?? 0) + (u.cacheWriteTokens ?? 0);
    if (u.inputTokens != null && cacheSum > u.inputTokens) u.inputTokens = cacheSum;
    if (u.outputTokens != null && (u.reasoningTokens ?? 0) > u.outputTokens) {
      u.outputTokens = u.reasoningTokens!;
    }
    return u;
  };

  // breadcrumb.* — manual tracing, trusted as-is.
  const bcIn = num(attrs["breadcrumb.inputTokens"]);
  const bcOut = num(attrs["breadcrumb.outputTokens"]);
  if (bcIn !== null || bcOut !== null) {
    return clampSubsets({
      inputTokens: bcIn,
      outputTokens: bcOut,
      cachedInputTokens: num(attrs["breadcrumb.cachedInputTokens"]),
      cacheWriteTokens: num(attrs["breadcrumb.cacheWriteTokens"]),
      reasoningTokens: num(attrs["breadcrumb.reasoningTokens"]),
    });
  }

  const aiOp = str(attrs["ai.operationId"]);
  if (aiOp !== null && !isAiUsageCarrier(aiOp)) return { ...EMPTY_USAGE };

  // ai.* (Vercel AI SDK v5) — inputTokens cache-inclusive, cached a subset.
  // Embedding spans report a single ai.usage.tokens count; that's input.
  const aiIn = first(
    num(attrs["ai.usage.inputTokens"]),
    num(attrs["ai.usage.promptTokens"]),
    num(attrs["ai.usage.tokens"])
  );
  const aiOut = first(num(attrs["ai.usage.outputTokens"]), num(attrs["ai.usage.completionTokens"]));
  if (aiIn !== null || aiOut !== null) {
    return clampSubsets({
      inputTokens: aiIn,
      outputTokens: aiOut,
      cachedInputTokens: num(attrs["ai.usage.cachedInputTokens"]),
      cacheWriteTokens: null, // v5 never reports cache writes; they arrive via gen_ai.*
      reasoningTokens: num(attrs["ai.usage.reasoningTokens"]),
    });
  }

  // gen_ai.* (OTel semconv) — cache/reasoning attributes are subsets of the
  // input/output totals per spec; the clamp recovers non-compliant emitters.
  const gaIn = num(attrs["gen_ai.usage.input_tokens"]);
  const gaOut = num(attrs["gen_ai.usage.output_tokens"]);
  if (gaIn !== null || gaOut !== null) {
    return clampSubsets({
      inputTokens: gaIn,
      outputTokens: gaOut,
      cachedInputTokens: num(attrs["gen_ai.usage.cache_read.input_tokens"]),
      cacheWriteTokens: num(attrs["gen_ai.usage.cache_creation.input_tokens"]),
      reasoningTokens: num(attrs["gen_ai.usage.reasoning.output_tokens"]),
    });
  }

  return { ...EMPTY_USAGE };
}

/**
 * Whether the functionId should stand in for this span's name. It should when
 * the name came from the AI SDK's own operation (`ai.streamText`), which says
 * nothing about the work; a span the caller named itself keeps that name.
 *
 * The SDK stamps `ai.telemetry.functionId` on every span of a call — the
 * operation wrapper, the `.do*` model call and each `ai.toolCall` alike — so
 * only the wrapper takes its name from it, or one call would read as three
 * identical rows.
 */
function namedByFunctionId(attrs: Attrs): boolean {
  const op = str(attrs["ai.operationId"]);
  return op !== null && !op.includes(".do");
}

export function normalizeSpanData(data: OtelSpanData, defaultEnvironment: string): SpanRecord {
  const attrs = data.attributes;
  const isError = data.error !== null;

  const functionId = first(
    str(attrs["breadcrumb.functionId"]),
    str(attrs["ai.telemetry.functionId"])
  );

  // Tool spans arrive named after the operation (`ai.toolCall`), not the tool,
  // so every tool in a trace would read alike. The tool name is the useful one.
  // Below that, the caller's functionId beats the SDK's operation name wherever
  // the span sits: assuming it sits at the root only holds while breadcrumb
  // owns the trace, and any other instrumentation (Sentry, Langfuse, an HTTP
  // middleware) puts a span above it and drops the run back to `ai.streamText`.
  const toolName = first(str(attrs["ai.toolCall.name"]), str(attrs["gen_ai.tool.name"]));
  const name = toolName ?? (namedByFunctionId(attrs) ? functionId : null) ?? data.name;

  const kind = inferKind(data.name, attrs);

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

  const provider = first(
    str(attrs["breadcrumb.provider"]),
    str(attrs["ai.model.provider"]),
    str(attrs["gen_ai.provider.name"]),
    str(attrs["gen_ai.system"])
  );
  const usage = normalizeUsage(attrs);

  return {
    id: data.spanId,
    traceId: data.traceId,
    parentSpanId: data.parentSpanId,
    name,
    functionId,
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
    provider,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
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
