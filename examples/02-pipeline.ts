/**
 * 02-pipeline — retrieval-augmented generation (RAG).
 *
 * Two sequential top-level spans: vector search then LLM generation.
 * Run: BREADCRUMB_API_KEY=... npm run pipeline --workspace=examples
 */

import { Breadcrumb } from "@breadcrumb/sdk";
import { config, sleep } from "./config.js";

const bc = new Breadcrumb(config);

const query = "What are the main features of TypeScript?";

const trace = bc.trace({
  name:        "rag-pipeline",
  input:       { query },
  userId:      "user-demo",
  environment: "development",
});

console.log("trace started:", trace.id);

// ── 1. Retrieval ──────────────────────────────────────────────────────────────

const retrieval = trace.span({
  name:  "vector-search",
  type:  "retrieval",
  input: { query, topK: 3 },
});

await sleep(120);

const docs = [
  "TypeScript adds optional static typing to JavaScript.",
  "TypeScript supports interfaces, generics, enums, and decorators.",
  "TypeScript compiles to plain JavaScript and runs anywhere JS runs.",
];

retrieval.end({
  output: { results: docs, count: docs.length },
});

console.log("retrieval done");

// ── 2. Generation ─────────────────────────────────────────────────────────────

const llm = trace.span({
  name:     "generate-answer",
  type:     "llm",
  provider: "anthropic",
  input: {
    system:  "Answer concisely using the provided context only.",
    context: docs,
    query,
  },
});

await sleep(890);

const answer =
  "TypeScript's main features include optional static typing, " +
  "interfaces, generics, enums, and decorator support. " +
  "It compiles to JavaScript and works anywhere JavaScript does.";

llm.end({
  output:       { content: answer },
  model:        "claude-opus-4-6",
  inputTokens:  312,
  outputTokens: 58,
  inputCostUsd:  0.000936,
  outputCostUsd: 0.000870,
});

console.log("generation done");

// ── Finish ────────────────────────────────────────────────────────────────────

trace.end({ output: { answer } });

await bc.shutdown();
console.log("done");
