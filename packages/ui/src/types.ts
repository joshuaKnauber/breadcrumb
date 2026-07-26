// Mirrors @breadcrumb-sh/core's API types (kept in sync by hand — the UI is
// built inside the same repo, and the contract is small).

export type SpanKind = "span" | "llm" | "tool" | "embedding" | "retrieval" | "agent";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SessionSummary {
  sessionKey: string;
  sessionId: string | null;
  userId: string | null;
  environment: string;
  startTime: number;
  endTime: number | null;
  runCount: number;
  errorCount: number;
  failName: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface RunSummary {
  traceId: string;
  name: string;
  input: unknown;
  output: unknown;
  startTime: number;
  endTime: number | null;
  spanCount: number;
  errorCount: number;
  failName: string | null;
  failError: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface CostDatum {
  day: string;
  model: string | null;
  cost: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  count: number;
}

export interface CostGroup {
  key: string | null;
  cost: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  count: number;
}

export interface CostSummary {
  windowDays: number;
  totals: { cost: number; inputTokens: number; cachedInputTokens: number; outputTokens: number };
  days: CostDatum[];
  byModel: CostGroup[];
  byFunction: CostGroup[];
}

export interface McpKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface SpanRecord {
  id: string;
  traceId: string;
  parentSpanId?: string | null;
  name: string;
  kind: SpanKind;
  environment: string;
  userId?: string | null;
  sessionId?: string | null;
  model?: string | null;
  provider?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
  cost?: number | null;
  status: "ok" | "error";
  error?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown> | null;
  startTime: number;
  endTime?: number | null;
}
