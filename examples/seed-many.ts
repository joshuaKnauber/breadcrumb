/**
 * seed-many — runs all four example scenarios repeatedly to populate the dashboard.
 *
 * Run: tsx seed-many.ts   (from the examples/ directory)
 * Or:  npm run seed-many --workspace=examples
 */

import { Breadcrumb } from "@breadcrumb/sdk";
import { config, sleep } from "./config.js";

const ROUNDS = 5;

// ── Scenario definitions ──────────────────────────────────────────────────────

async function runSimple(bc: Breadcrumb) {
  const question = "What is the capital of France?";
  const trace = bc.trace({ name: "simple-chat", input: { messages: [{ role: "user", content: question }] } });
  const span = trace.span({ name: "claude-completion", type: "llm", provider: "anthropic", model: "claude-opus-4-6", input: { messages: [{ role: "user", content: question }] } });
  await sleep(300 + Math.random() * 300);
  span.end({ output: { role: "assistant", content: "The capital of France is Paris." }, inputTokens: 22, outputTokens: 10, inputCostUsd: 0.000066, outputCostUsd: 0.000150 });
  trace.end({ output: { answer: "The capital of France is Paris." } });
}

async function runPipeline(bc: Breadcrumb) {
  const query = "What are the main features of TypeScript?";
  const trace = bc.trace({ name: "rag-pipeline", input: { query }, userId: "user-demo", environment: "development" });

  const retrieval = trace.span({ name: "vector-search", type: "retrieval", input: { query, topK: 3 } });
  await sleep(80 + Math.random() * 100);
  const docs = [
    "TypeScript adds optional static typing to JavaScript.",
    "TypeScript supports interfaces, generics, enums, and decorators.",
    "TypeScript compiles to plain JavaScript and runs anywhere JS runs.",
  ];
  retrieval.end({ output: { results: docs, count: docs.length } });

  const llm = trace.span({ name: "generate-answer", type: "llm", provider: "anthropic", input: { system: "Answer concisely using the provided context only.", context: docs, query } });
  await sleep(600 + Math.random() * 400);
  const answer = "TypeScript's main features include optional static typing, interfaces, generics, enums, and decorator support.";
  llm.end({ output: { content: answer }, model: "claude-opus-4-6", inputTokens: 312, outputTokens: 58, inputCostUsd: 0.000936, outputCostUsd: 0.000870 });

  trace.end({ output: { answer } });
}

async function runAgent(bc: Breadcrumb) {
  const task = "What is the weather in Paris and London right now?";
  const trace = bc.trace({ name: "weather-agent", input: { task } });

  const step1 = trace.span({ name: "agent-step-1", type: "chain" });
  const llm1 = step1.span({ name: "plan", type: "llm", provider: "anthropic", model: "claude-opus-4-6", input: { task, tools: ["get_weather"] } });
  await sleep(400 + Math.random() * 200);
  llm1.end({ output: { toolCall: { name: "get_weather", args: { city: "Paris" } } }, inputTokens: 145, outputTokens: 28, inputCostUsd: 0.000435, outputCostUsd: 0.000420 });
  const tool1 = step1.span({ name: "get_weather", type: "tool", input: { city: "Paris" } });
  await sleep(100 + Math.random() * 100);
  tool1.end({ output: { city: "Paris", temperature: 18, conditions: "Partly cloudy" } });
  step1.end();

  const step2 = trace.span({ name: "agent-step-2", type: "chain" });
  const llm2 = step2.span({ name: "plan", type: "llm", provider: "anthropic", model: "claude-opus-4-6", input: { previousResults: ["Paris: 18°C, partly cloudy"], tools: ["get_weather"] } });
  await sleep(350 + Math.random() * 200);
  llm2.end({ output: { toolCall: { name: "get_weather", args: { city: "London" } } }, inputTokens: 198, outputTokens: 24, inputCostUsd: 0.000594, outputCostUsd: 0.000360 });
  const tool2 = step2.span({ name: "get_weather", type: "tool", input: { city: "London" } });
  await sleep(100 + Math.random() * 100);
  tool2.end({ output: { city: "London", temperature: 12, conditions: "Overcast" } });
  step2.end();

  const step3 = trace.span({ name: "agent-step-3", type: "chain" });
  const llm3 = step3.span({ name: "respond", type: "llm", provider: "anthropic", model: "claude-opus-4-6", input: { task, results: ["Paris: 18°C, partly cloudy", "London: 12°C, overcast"] } });
  await sleep(300 + Math.random() * 200);
  const finalAnswer = "In Paris it's currently 18°C and partly cloudy. In London it's 12°C and overcast.";
  llm3.end({ output: { content: finalAnswer }, inputTokens: 244, outputTokens: 42, inputCostUsd: 0.000732, outputCostUsd: 0.000630 });
  step3.end();

  trace.end({ output: { answer: finalAnswer } });
}

async function runError(bc: Breadcrumb) {
  const prompt = "Write a 10,000 word essay on the history of computing.";
  const trace = bc.trace({ name: "failed-generation", input: { prompt } });
  const span = trace.span({ name: "claude-completion", type: "llm", provider: "anthropic", model: "claude-opus-4-6", input: { prompt } });
  await sleep(1500 + Math.random() * 700);
  span.end({ status: "error", statusMessage: "LLM request timed out after 2000ms" });
  trace.end({ status: "error", statusMessage: "Generation failed: LLM request timed out" });
}

// ── Runner ────────────────────────────────────────────────────────────────────

const SCENARIOS: Array<{ name: string; run: (bc: Breadcrumb) => Promise<void> }> = [
  { name: "simple",   run: runSimple   },
  { name: "pipeline", run: runPipeline },
  { name: "agent",    run: runAgent    },
  { name: "error",    run: runError    },
];

let total = 0;
let failed = 0;

console.log(`Running ${SCENARIOS.length} scenarios × ${ROUNDS} rounds = ${SCENARIOS.length * ROUNDS} traces\n`);

for (let round = 1; round <= ROUNDS; round++) {
  // Shuffle so the timeline has a realistic mix of trace types
  const shuffled = [...SCENARIOS].sort(() => Math.random() - 0.5);

  for (const scenario of shuffled) {
    process.stdout.write(`  [${round}/${ROUNDS}] ${scenario.name.padEnd(10)} ... `);
    total++;

    // Each trace gets its own SDK instance so shutdown/flush doesn't cross-contaminate
    const bc = new Breadcrumb(config);
    try {
      await scenario.run(bc);
      await bc.shutdown();
      console.log("ok");
    } catch (err) {
      failed++;
      console.log("FAILED");
      console.error(err);
      await bc.shutdown().catch(() => {});
    }
  }
}

console.log(`\nDone. ${total - failed}/${total} traces sent successfully.`);
if (failed > 0) process.exit(1);
