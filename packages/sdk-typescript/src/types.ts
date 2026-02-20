import type { SpanType, Status } from "@breadcrumb/core";

export interface TraceOptions {
  name: string;
  input?: unknown;
  userId?: string;
  sessionId?: string;
  environment?: string;
  tags?: Record<string, string>;
}

export interface TraceEndOptions {
  output?: unknown;
  status?: Status;
  /** Human-readable error message when status is "error". */
  statusMessage?: string;
}

export interface SpanOptions {
  name: string;
  type: SpanType;
  input?: unknown;
  /** e.g. "anthropic", "openai" */
  provider?: string;
  /** e.g. "claude-opus-4-6", "gpt-4o" */
  model?: string;
  metadata?: Record<string, string>;
}

export interface SpanEndOptions {
  output?: unknown;
  status?: Status;
  statusMessage?: string;
  /**
   * Override the model set at span start.
   * Useful when the model isn't known until the response arrives.
   */
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Float USD, e.g. 0.000123 */
  inputCostUsd?: number;
  /** Float USD */
  outputCostUsd?: number;
}
