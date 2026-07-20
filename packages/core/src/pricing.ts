import type { SpanRecord } from "./db/types.js";

/** USD per 1M tokens. Rough public list prices — estimates, override as needed. */
export interface ModelPrice {
  input: number;
  output: number;
}

export type PricingTable = Record<string, ModelPrice>;

/**
 * Keys are matched as lowercase substrings of the span's model, longest key
 * wins (so "claude-opus" beats "claude"). Deliberately small; extend via the
 * `pricing` config option. Prices are approximate and change over time.
 */
export const DEFAULT_PRICING: PricingTable = {
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "o3": { input: 2, output: 8 },
  "claude-opus": { input: 15, output: 75 },
  "claude-sonnet": { input: 3, output: 15 },
  "claude-haiku": { input: 0.8, output: 4 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "text-embedding": { input: 0.1, output: 0 },
};

export type Pricing = PricingTable | false;

export function resolvePricing(option: Pricing | undefined): PricingTable | null {
  if (option === false) return null;
  if (option === undefined) return DEFAULT_PRICING;
  return { ...DEFAULT_PRICING, ...option };
}

function priceFor(model: string, table: PricingTable): ModelPrice | null {
  const needle = model.toLowerCase();
  let best: ModelPrice | null = null;
  let bestLen = 0;
  for (const [key, price] of Object.entries(table)) {
    if (key.length > bestLen && needle.includes(key)) {
      best = price;
      bestLen = key.length;
    }
  }
  return best;
}

export function inferCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  table: PricingTable
): number | null {
  const price = priceFor(model, table);
  if (!price) return null;
  return (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
}

/** Fills span.cost from tokens + model when not already set. Mutates and returns. */
export function applyPricing(span: SpanRecord, table: PricingTable | null): SpanRecord {
  if (table === null || span.cost != null || !span.model) return span;
  const input = span.inputTokens ?? 0;
  const output = span.outputTokens ?? 0;
  if (input === 0 && output === 0) return span;
  const cost = inferCost(span.model, input, output, table);
  if (cost != null) span.cost = cost;
  return span;
}
