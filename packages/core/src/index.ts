// Shared types — will be expanded when we design the schema
export interface LLMSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}
