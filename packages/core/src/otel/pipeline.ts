import { context, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type { SpanRecord } from "../db/types.js";
import { normalizeOtelSpan } from "./normalize.js";

/** Matches the AI SDK's telemetry metadata constraint (OTel AttributeValue). */
export type TelemetryMetadataValue = string | number | boolean | string[] | number[] | boolean[];

export interface TelemetryOptions {
  functionId?: string;
  metadata?: Record<string, TelemetryMetadataValue>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
}

/** The settings object the Vercel AI SDK expects for experimental_telemetry. */
export interface TelemetrySettings extends TelemetryOptions {
  isEnabled: true;
  tracer: Tracer;
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
    this.write(spans.map((s) => normalizeOtelSpan(s, this.environment)))
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
}): TelemetryPipeline {
  ensureContextManager();

  const exporter = new AdapterSpanExporter(deps.write, deps.environment);
  const provider = new BasicTracerProvider({
    spanProcessors: [new BatchSpanProcessor(exporter, { scheduledDelayMillis: 2000 })],
  });
  const tracer = provider.getTracer("breadcrumb");

  return {
    tracer,
    telemetry(options = {}) {
      return { isEnabled: true, tracer, ...options };
    },
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
