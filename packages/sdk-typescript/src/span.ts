import { generateSpanId } from "@breadcrumb/core";
import type { IngestClient, SpanPayload, TraceId, SpanId, SpanType } from "@breadcrumb/core";
import type { SpanOptions, SpanEndOptions } from "./types.js";

/**
 * A handle to an in-progress span.
 *
 * Obtain one via TraceHandle.span() or SpanHandle.span().
 * Call .end() when the work is complete.
 */
export class SpanHandle {
  readonly id: SpanId;

  readonly #client: IngestClient;
  readonly #traceId: TraceId;
  readonly #parentSpanId: SpanId | undefined;
  readonly #name: string;
  readonly #type: SpanType;
  readonly #startTime: string;
  readonly #input: unknown;
  readonly #provider: string | undefined;
  readonly #model: string | undefined;
  readonly #metadata: Record<string, string> | undefined;

  #ended = false;

  /** @internal */
  constructor(
    client: IngestClient,
    traceId: TraceId,
    opts: SpanOptions,
    parentSpanId?: SpanId,
  ) {
    this.id             = generateSpanId();
    this.#client        = client;
    this.#traceId       = traceId;
    this.#parentSpanId  = parentSpanId;
    this.#name          = opts.name;
    this.#type          = opts.type;
    this.#startTime     = new Date().toISOString();
    this.#input         = opts.input;
    this.#provider      = opts.provider;
    this.#model         = opts.model;
    this.#metadata      = opts.metadata;
  }

  /**
   * Start a nested child span with this span as its parent.
   * Call .end() on the returned handle when the child work is complete.
   */
  span(opts: SpanOptions): SpanHandle {
    return new SpanHandle(this.#client, this.#traceId, opts, this.id);
  }

  /**
   * End the span, recording end_time now, and buffer it for sending.
   *
   * Calling end() more than once is a no-op — only the first call is recorded.
   * Model and provider can be overridden here if not known until the response.
   */
  end(opts: SpanEndOptions = {}): void {
    if (this.#ended) return;
    this.#ended = true;

    const payload: SpanPayload = {
      id:              this.id,
      trace_id:        this.#traceId,
      parent_span_id:  this.#parentSpanId,
      name:            this.#name,
      type:            this.#type,
      start_time:      this.#startTime,
      end_time:        new Date().toISOString(),
      status:          opts.status        ?? "ok",
      status_message:  opts.statusMessage,
      input:           this.#input,
      output:          opts.output,
      provider:        opts.provider      ?? this.#provider,
      model:           opts.model         ?? this.#model,
      input_tokens:    opts.inputTokens,
      output_tokens:   opts.outputTokens,
      input_cost_usd:  opts.inputCostUsd,
      output_cost_usd: opts.outputCostUsd,
      metadata:        this.#metadata,
    };

    this.#client.sendSpan(payload);
  }
}
