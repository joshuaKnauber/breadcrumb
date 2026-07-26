import type { SpanRecord } from "./db/types.js";

/** USD per 1M tokens, as declared by your app. breadcrumb ships no prices. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Price per 1M cache-read tokens. Defaults to `input` (no discount assumed). */
  cachedInput?: number;
  /** Price per 1M cache-write tokens. Defaults to `input` (no premium assumed). */
  cacheWrite?: number;
}

/**
 * Your model prices, keyed by model name. Keys match as lowercase substrings
 * of the span's model, longest key wins (so "claude-opus" beats "claude").
 */
export type PricingTable = Record<string, ModelPrice>;

export type Pricing = PricingTable | false;

/** No prices unless the app declares them — breadcrumb never assumes costs. */
export function resolvePricing(option: Pricing | undefined): PricingTable | null {
  if (!option) return null;
  return option;
}

function priceFor(model: string, table: PricingTable): ModelPrice | null {
  const needle = model.toLowerCase();
  let best: ModelPrice | null = null;
  let bestLen = 0;
  for (const [key, price] of Object.entries(table)) {
    if (key.length > bestLen && needle.includes(key.toLowerCase())) {
      best = price;
      bestLen = key.length;
    }
  }
  return best;
}

export interface CostTokens {
  /** Total input, inclusive of cached reads/writes. */
  inputTokens: number;
  outputTokens: number;
  /** Cache-read tokens (subset of inputTokens). */
  cachedInputTokens?: number;
  /** Cache-write tokens (subset of inputTokens). */
  cacheWriteTokens?: number;
}

/**
 * Cost from the price table, splitting input into non-cached / cache-read /
 * cache-write tiers. Cached tiers fall back to the base input price when no
 * cache price is declared — so we never invent a discount or premium.
 */
export function computeCost(model: string, tokens: CostTokens, table: PricingTable): number | null {
  const price = priceFor(model, table);
  if (!price) return null;
  const cacheRead = tokens.cachedInputTokens ?? 0;
  const cacheWrite = tokens.cacheWriteTokens ?? 0;
  const nonCached = Math.max(tokens.inputTokens - cacheRead - cacheWrite, 0);
  return (
    (nonCached / 1e6) * price.input +
    (cacheRead / 1e6) * (price.cachedInput ?? price.input) +
    (cacheWrite / 1e6) * (price.cacheWrite ?? price.input) +
    (tokens.outputTokens / 1e6) * price.output
  );
}

/**
 * Fills span.cost from tokens + the app-declared price table, only when cost
 * wasn't already provided. No table → nothing happens.
 */
export function applyPricing(span: SpanRecord, table: PricingTable | null): SpanRecord {
  if (table === null || span.cost != null || !span.model) return span;
  const inputTokens = span.inputTokens ?? 0;
  const outputTokens = span.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return span;
  const cost = computeCost(
    span.model,
    {
      inputTokens,
      outputTokens,
      cachedInputTokens: span.cachedInputTokens ?? 0,
      cacheWriteTokens: span.cacheWriteTokens ?? 0,
    },
    table
  );
  if (cost != null) span.cost = cost;
  return span;
}
