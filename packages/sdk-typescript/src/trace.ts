import { generateTraceId } from "@breadcrumb/core";
import type { IngestClient, TracePayload, TraceId } from "@breadcrumb/core";
import { SpanHandle } from "./span.js";
import type { TraceOptions, TraceEndOptions, SpanOptions } from "./types.js";

/**
 * A handle to an in-progress trace.
 *
 * Obtain one via Breadcrumb.trace(). Call .end() when the operation completes.
 *
 * The trace start event is sent immediately on construction so the trace
 * appears in the dashboard even before it finishes.
 */
export class TraceHandle {
  readonly id: TraceId;

  readonly #client: IngestClient;
  readonly #name: string;
  readonly #startTime: string;

  #ended = false;

  /** @internal */
  constructor(client: IngestClient, opts: TraceOptions) {
    this.id          = generateTraceId();
    this.#client     = client;
    this.#name       = opts.name;
    this.#startTime  = new Date().toISOString();

    // Send the start event so the trace is visible immediately.
    // The server's ReplacingMergeTree will keep the end() call's row
    // (higher version) once it arrives.
    const payload: TracePayload = {
      id:          this.id,
      name:        opts.name,
      start_time:  this.#startTime,
      input:       opts.input,
      user_id:     opts.userId,
      session_id:  opts.sessionId,
      environment: opts.environment,
      tags:        opts.tags,
    };
    this.#client.sendTrace(payload);
  }

  /**
   * Start a top-level span within this trace.
   * For nested spans, call .span() on the returned SpanHandle instead.
   */
  span(opts: SpanOptions): SpanHandle {
    return new SpanHandle(this.#client, this.id, opts);
  }

  /**
   * End the trace, recording end_time now, and buffer the end event.
   *
   * Calling end() more than once is a no-op — only the first call is recorded.
   */
  end(opts: TraceEndOptions = {}): void {
    if (this.#ended) return;
    this.#ended = true;

    const payload: TracePayload = {
      id:             this.id,
      name:           this.#name,
      start_time:     this.#startTime,
      end_time:       new Date().toISOString(),
      status:         opts.status        ?? "ok",
      status_message: opts.statusMessage,
      output:         opts.output,
    };
    this.#client.sendTrace(payload);
  }
}
