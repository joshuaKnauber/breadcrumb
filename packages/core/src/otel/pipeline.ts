import { context, type Context, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { SpanRecord } from "../db/types.js";
import { fromReadableSpan, normalizeSpanData } from "./normalize.js";

/** Matches the AI SDK's telemetry metadata constraint (OTel AttributeValue). */
export type TelemetryMetadataValue = string | number | boolean | string[] | number[] | boolean[];

export interface TelemetryOptions {
  /** Names the operation. Every span of the call carries it, so a run reads as
   * what it does rather than as `ai.streamText`, wherever it sits in a trace. */
  functionId?: string;
  /** Your app's end-user id — groups and filters traces by who ran them. */
  userId?: string;
  /** Groups related runs into one conversation/session. */
  sessionId?: string;
  metadata?: Record<string, TelemetryMetadataValue>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
}

/** The settings object the Vercel AI SDK expects for experimental_telemetry. */
export interface TelemetrySettings {
  isEnabled: true;
  tracer: Tracer;
  functionId?: string;
  metadata?: Record<string, TelemetryMetadataValue>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
}

export interface TelemetryPipeline {
  tracer: Tracer;
  telemetry(options?: TelemetryOptions): TelemetrySettings;
  /** Register on your own TracerProvider to write its spans to breadcrumb. */
  readonly spanProcessor: SpanProcessor;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

let contextManagerInstalled = false;

/** Span context propagation across awaits needs an async-hooks context manager.
 * Only install ours if the host app hasn't registered one already. */
function ensureContextManager(): void {
  if (contextManagerInstalled) return;
  const manager = new AsyncLocalStorageContextManager();
  manager.enable();
  if (!context.setGlobalContextManager(manager)) {
    manager.disable();
  }
  contextManagerInstalled = true;
}

class AdapterSpanExporter implements SpanExporter {
  constructor(
    private write: (spans: SpanRecord[]) => Promise<void>,
    private environment: string
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.write(spans.map((s) => normalizeSpanData(fromReadableSpan(s), this.environment)))
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) => {
        console.error("[breadcrumb] failed to write spans:", error);
        resultCallback({ code: ExportResultCode.FAILED, error });
      });
  }

  async shutdown(): Promise<void> {}
}

const DIALECTS = ["ai.", "gen_ai.", "breadcrumb."];

/** On a shared provider the processor sees every span in the app — HTTP, database,
 * filesystem. Default to the ones breadcrumb can actually read, so registering it
 * doesn't turn the trace table into a general-purpose span dump. */
function isModelSpan(span: ReadableSpan): boolean {
  for (const key of Object.keys(span.attributes)) {
    if (DIALECTS.some((prefix) => key.startsWith(prefix))) return true;
  }
  return false;
}

class FilteredSpanProcessor implements SpanProcessor {
  constructor(
    private inner: SpanProcessor,
    private shouldExport: (span: ReadableSpan) => boolean
  ) {}

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (this.shouldExport(span)) this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

export function createTelemetryPipeline(deps: {
  environment: string;
  write: (spans: SpanRecord[]) => Promise<void>;
  /** "sync" exports each span as it ends (serverless/edge); default batches. */
  flushMode?: "batch" | "sync";
  /** Overrides which spans the exposed spanProcessor keeps. */
  shouldExport?: (span: ReadableSpan) => boolean;
}): TelemetryPipeline {
  ensureContextManager();

  const exporter = new AdapterSpanExporter(deps.write, deps.environment);
  const newProcessor = (): SpanProcessor =>
    deps.flushMode === "sync"
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter, { scheduledDelayMillis: 2000 });
  const provider = new BasicTracerProvider({ spanProcessors: [newProcessor()] });
  const tracer = provider.getTracer("breadcrumb");

  // Built on first access: apps that never register it shouldn't pay for a
  // second batch processor's timer.
  let external: SpanProcessor | null = null;

  return {
    tracer,
    get spanProcessor() {
      return (external ??= new FilteredSpanProcessor(
        newProcessor(),
        deps.shouldExport ?? isModelSpan
      ));
    },
    // userId and sessionId ride along as telemetry metadata, which is the only
    // channel the AI SDK forwards. Naming them here rather than leaving them as
    // two metadata keys that happen to be read back on ingest is the difference
    // between a documented option and a secret.
    telemetry({ userId, sessionId, metadata, ...rest } = {}) {
      const merged: Record<string, TelemetryMetadataValue> = { ...metadata };
      if (userId !== undefined) merged.userId = userId;
      if (sessionId !== undefined) merged.sessionId = sessionId;
      return {
        isEnabled: true,
        tracer,
        ...rest,
        ...(Object.keys(merged).length > 0 ? { metadata: merged } : {}),
      };
    },
    async flush() {
      await Promise.all([provider.forceFlush(), external?.forceFlush()]);
    },
    async shutdown() {
      await Promise.all([provider.shutdown(), external?.shutdown()]);
    },
  };
}
