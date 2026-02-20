import type { TracePayload, SpanPayload } from "./types.js";

export interface IngestClientOptions {
  /**
   * Your project API key, e.g. "bc_live_...".
   * Passed as `Authorization: Bearer <apiKey>` on every request.
   */
  apiKey: string;
  /**
   * Base URL of the Breadcrumb ingest server.
   * Defaults to http://localhost:3001 for local development.
   */
  baseUrl?: string;
  /**
   * How often (ms) to automatically flush buffered events.
   * Set to 0 to disable the timer and manage flushing manually.
   * Default: 2000
   */
  flushInterval?: number;
  /**
   * Flush immediately when the span buffer reaches this size,
   * regardless of the timer. Default: 100
   */
  maxBatchSize?: number;
  /**
   * Called when a background (timer-triggered) flush fails.
   * Manual calls to flush() / shutdown() still throw.
   * Default: silent.
   */
  onError?: (err: Error) => void;
}

/**
 * Buffered HTTP client for the Breadcrumb ingest API.
 *
 * Events are collected in memory and sent in batches to reduce
 * request overhead. Spans are flushed as a single array request;
 * trace events are sent in parallel (one request each — the server
 * accepts one trace per call).
 *
 * Lifecycle:
 *   1. Construct with your API key.
 *   2. Call sendTrace() / sendSpan() / sendSpans() freely (synchronous).
 *   3. Call shutdown() before process exit to drain remaining events.
 *
 * Uses the native `fetch` API (Node.js >= 18, all modern browsers).
 */
export class IngestClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #flushInterval: number;
  readonly #maxBatchSize: number;
  readonly #onError: (err: Error) => void;

  #spanBuffer: SpanPayload[]  = [];
  #traceBuffer: TracePayload[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: IngestClientOptions) {
    this.#apiKey        = opts.apiKey;
    this.#baseUrl       = (opts.baseUrl ?? "http://localhost:3001").replace(/\/$/, "");
    this.#flushInterval = opts.flushInterval ?? 2000;
    this.#maxBatchSize  = opts.maxBatchSize  ?? 100;
    this.#onError       = opts.onError       ?? (() => {});

    if (this.#flushInterval > 0) {
      this.#scheduleFlush();
    }
  }

  // ── Buffer methods (synchronous) ──────────────────────────────────────────

  /** Buffer a trace event. Triggers an immediate flush if the buffer is full. */
  sendTrace(payload: TracePayload): void {
    this.#traceBuffer.push(payload);
    if (this.#traceBuffer.length >= this.#maxBatchSize) {
      this.#autoFlush();
    }
  }

  /** Buffer a span. Triggers an immediate flush if the buffer is full. */
  sendSpan(payload: SpanPayload): void {
    this.#spanBuffer.push(payload);
    if (this.#spanBuffer.length >= this.#maxBatchSize) {
      this.#autoFlush();
    }
  }

  /** Buffer multiple spans. Triggers an immediate flush if the buffer is full. */
  sendSpans(payloads: SpanPayload[]): void {
    this.#spanBuffer.push(...payloads);
    if (this.#spanBuffer.length >= this.#maxBatchSize) {
      this.#autoFlush();
    }
  }

  // ── Flush / shutdown ──────────────────────────────────────────────────────

  /**
   * Drain all buffered events immediately.
   *
   * - Buffered spans are sent in a single batched request.
   * - Buffered trace events are sent in parallel (one request each).
   *
   * Both buffers are spliced synchronously before any await, so concurrent
   * calls are safe — each gets a disjoint snapshot of the buffers.
   */
  async flush(): Promise<void> {
    const traces = this.#traceBuffer.splice(0);
    const spans  = this.#spanBuffer.splice(0);

    const requests: Promise<void>[] = [];

    for (const trace of traces) {
      requests.push(this.#post("/v1/traces", trace));
    }
    if (spans.length > 0) {
      requests.push(this.#post("/v1/spans", spans));
    }

    if (requests.length > 0) {
      await Promise.all(requests);
    }
  }

  /**
   * Stop the auto-flush timer and flush any remaining buffered events.
   * Call this before process exit to ensure nothing is lost.
   *
   * @example
   * process.on("SIGTERM", () => client.shutdown().then(() => process.exit(0)));
   */
  async shutdown(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.flush();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Fire-and-forget flush used by the timer and size threshold. */
  #autoFlush(): void {
    this.flush().catch(this.#onError);
  }

  #scheduleFlush(): void {
    this.#timer = setTimeout(() => {
      this.flush()
        .catch(this.#onError)
        .finally(() => { this.#scheduleFlush(); });
    }, this.#flushInterval);

    // Don't prevent Node.js from exiting if this timer is the only thing
    // keeping the event loop alive.
    if (typeof this.#timer === "object" && this.#timer !== null && "unref" in this.#timer) {
      (this.#timer as { unref(): void }).unref();
    }
  }

  async #post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.#baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[breadcrumb] ingest error ${res.status}: ${text}`);
    }
  }
}
