import { context, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
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

export function createTelemetryPipeline(deps: {
  environment: string;
  write: (spans: SpanRecord[]) => Promise<void>;
  /** "sync" exports each span as it ends (serverless/edge); default batches. */
  flushMode?: "batch" | "sync";
}): TelemetryPipeline {
  ensureContextManager();

  const exporter = new AdapterSpanExporter(deps.write, deps.environment);
  const processor =
    deps.flushMode === "sync"
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter, { scheduledDelayMillis: 2000 });
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  const tracer = provider.getTracer("breadcrumb");

  return {
    tracer,
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
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
