import { IngestClient } from "@breadcrumb/core";
import type { IngestClientOptions } from "@breadcrumb/core";
import { TraceHandle } from "./trace.js";
import type { TraceOptions } from "./types.js";

/**
 * The main entry point for the Breadcrumb SDK.
 *
 * @example
 * ```ts
 * import { Breadcrumb } from "@breadcrumb/sdk";
 *
 * const bc = new Breadcrumb({ apiKey: "bc_live_..." });
 *
 * const trace = bc.trace({ name: "summarise", input: { text } });
 * const span  = trace.span({ name: "llm", type: "llm", model: "claude-opus-4-6" });
 * const result = await callLLM(text);
 * span.end({ output: result.text, inputTokens: result.usage.input, outputTokens: result.usage.output });
 * trace.end({ output: result.text });
 *
 * // Before process exit:
 * await bc.shutdown();
 * ```
 */
export class Breadcrumb {
  readonly #client: IngestClient;

  constructor(opts: IngestClientOptions) {
    this.#client = new IngestClient(opts);
  }

  /**
   * Start a new trace. Call .end() on the returned handle when the
   * operation is complete.
   *
   * The trace start event is buffered immediately so the trace appears
   * in the dashboard even before it finishes.
   */
  trace(opts: TraceOptions): TraceHandle {
    return new TraceHandle(this.#client, opts);
  }

  /** Flush all buffered events immediately. */
  flush(): Promise<void> {
    return this.#client.flush();
  }

  /**
   * Stop the auto-flush timer and flush remaining buffered events.
   * Call this before process exit to ensure nothing is dropped.
   */
  shutdown(): Promise<void> {
    return this.#client.shutdown();
  }
}
