/**
 * 01-simple — one trace, one LLM span.
 *
 * The simplest possible usage: ask a question, get an answer.
 * Run: BREADCRUMB_API_KEY=... npm run simple --workspace=examples
 */

import { Breadcrumb } from "@breadcrumb/sdk";
import { config, sleep } from "./config.js";

const bc = new Breadcrumb(config);

const question = "What is the capital of France?";

const trace = bc.trace({
  name:  "simple-chat",
  input: { messages: [{ role: "user", content: question }] },
});

console.log("trace started:", trace.id);

const span = trace.span({
  name:     "claude-completion",
  type:     "llm",
  provider: "anthropic",
  model:    "claude-opus-4-6",
  input:    { messages: [{ role: "user", content: question }] },
});

// Simulate the LLM call
await sleep(450);

const answer = "The capital of France is Paris.";

span.end({
  output:       { role: "assistant", content: answer },
  inputTokens:  22,
  outputTokens: 10,
  inputCostUsd:  0.000066,
  outputCostUsd: 0.000150,
});

trace.end({
  output: { answer },
});

await bc.shutdown();
console.log("done");
