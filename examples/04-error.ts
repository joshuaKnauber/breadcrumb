/**
 * 04-error — trace with a failed span and error status.
 *
 * Shows how to record errors: pass status: "error" and a statusMessage
 * to both the span and the trace.
 *
 * Run: BREADCRUMB_API_KEY=... npm run error --workspace=examples
 */

import { Breadcrumb } from "@breadcrumb/sdk";
import { config, sleep } from "./config.js";

const bc = new Breadcrumb(config);

const prompt = "Write a 10,000 word essay on the history of computing.";

const trace = bc.trace({
  name:  "failed-generation",
  input: { prompt },
});

console.log("trace started:", trace.id);

// Span that will time out
const span = trace.span({
  name:     "claude-completion",
  type:     "llm",
  provider: "anthropic",
  model:    "claude-opus-4-6",
  input:    { prompt },
});

// Simulate a slow call that exceeds our timeout budget
await sleep(2100);

span.end({
  status:        "error",
  statusMessage: "LLM request timed out after 2000ms",
});

trace.end({
  status:        "error",
  statusMessage: "Generation failed: LLM request timed out",
});

await bc.shutdown();
console.log("done");
