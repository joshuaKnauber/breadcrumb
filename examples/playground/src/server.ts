/**
 * Playground app: mounts breadcrumb at /admin/traces and exposes endpoints
 * that produce traces. Uses a mock AI SDK model, so it runs offline.
 *
 *   npm run dev --workspace=examples/playground
 */
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { streamText } from "ai";
import type { LanguageModelV2, LanguageModelV2StreamPart } from "@ai-sdk/provider";
import { breadcrumb } from "@breadcrumb-sh/core";
import { sqlite } from "@breadcrumb-sh/core/adapters";
import { toNodeHandler } from "@breadcrumb-sh/core/node";

const PORT = 4200;
const BASE_PATH = "/admin/traces";

mkdirSync(".breadcrumb", { recursive: true });

const bc = breadcrumb({
  database: sqlite(".breadcrumb/playground.db"),
  basePath: BASE_PATH,
  environment: "development",
  ingest: { apiKey: "playground" },
  // The app declares its own model prices (USD per 1M tokens); breadcrumb
  // computes cost from token usage. No prices are assumed by the library.
  // cachedInput is the discounted cache-read rate (here 90% off).
  pricing: { "gpt-5": { input: 1.25, output: 10, cachedInput: 0.125 } },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Offline mock model so the playground needs no API key. Streams, because
// the AI SDK v5 only reports cache/reasoning token detail on doStream spans.
const model: LanguageModelV2 = {
  specificationVersion: "v2",
  provider: "openai",
  modelId: "gpt-5",
  supportedUrls: {},
  async doGenerate() {
    throw new Error("the mock model only streams");
  },
  async doStream() {
    const text = "Die Antwort auf deine Frage ist 42.";
    const inputTokens = 400 + Math.floor(Math.random() * 200);
    const outputTokens = 20 + Math.floor(Math.random() * 120);
    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "t" });
        for (const word of text.split(" ")) {
          await sleep(20 + Math.random() * 60);
          controller.enqueue({ type: "text-delta", id: "t", delta: word + " " });
        }
        controller.enqueue({ type: "text-end", id: "t" });
        controller.enqueue({
          type: "finish",
          finishReason: "stop",
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            // subsets: cache hits on the system prompt, thinking within output
            cachedInputTokens: Math.random() < 0.7 ? 320 : 0,
            reasoningTokens: Math.floor(outputTokens * 0.3),
          },
        });
        controller.close();
      },
    });
    return { stream };
  },
};

const USERS = ["anna", "ben", "carla"];

async function runPipeline(opts: { fail?: boolean } = {}): Promise<string> {
  const userId = USERS[Math.floor(Math.random() * USERS.length)]!;

  const question = opts.fail ? "was kostet das hosting?" : "wie funktioniert breadcrumb?";

  return bc.trace(
    "support-reply",
    { userId, sessionId: `session-${userId}`, metadata: { channel: "playground" } },
    async (t) => {
      t.set({ input: question });
      const docs = await t.span(
        "retrieve-docs",
        { kind: "retrieval", input: { query: question } },
        async (s) => {
          await sleep(50 + Math.random() * 100);
          if (opts.fail) throw new Error("vector index unavailable");
          const result = ["docs/setup.md", "docs/tracing.md"];
          s.set({ output: result });
          return result;
        }
      );

      // Nests under this trace automatically via OTel context propagation.
      const result = streamText({
        model,
        prompt: `Beantworte mit Kontext aus: ${docs.join(", ")}`,
        experimental_telemetry: bc.telemetry({
          functionId: "generate-answer",
          userId,
        }),
      });
      const text = await result.text;

      await t.span("format-response", { kind: "tool" }, async (s) => {
        await sleep(20);
        s.set({ output: { formatted: true } });
      });

      t.set({ output: text });
      return text;
    }
  );
}

const bcHandler = toNodeHandler(bc);

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  // In a real app this is where your auth middleware wraps the mount.
  if (url === BASE_PATH || url.startsWith(BASE_PATH + "/")) {
    return bcHandler(req, res);
  }

  if (url === "/run" && req.method === "POST") {
    const text = await runPipeline();
    await bc.flush();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ text }));
  }

  if (url === "/run-error" && req.method === "POST") {
    const text = await runPipeline({ fail: true }).catch((e) => `failed: ${e.message}`);
    await bc.flush();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ text }));
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<meta charset="utf-8">
<title>breadcrumb playground</title>
<style>body{font:16px system-ui;padding:3rem;max-width:32rem;margin:auto}button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}</style>
<h1>breadcrumb playground</h1>
<p>
  <button onclick="run('/run')">run pipeline</button>
  <button onclick="run('/run-error')">run failing pipeline</button>
  <a href="${BASE_PATH}">open traces →</a>
</p>
<p style="font-size:14px;color:#555">
  Run the failing pipeline a few times, then
  <a href="${BASE_PATH}/mcp">create an MCP key</a>
  and point your coding agent at these traces to debug them.
</p>
<pre id="out"></pre>
<script>
async function run(path) {
  document.getElementById("out").textContent = "…";
  const res = await fetch(path, { method: "POST" });
  document.getElementById("out").textContent = JSON.stringify(await res.json(), null, 2);
}
</script>`);
});

server.listen(PORT, () => {
  console.log(`▸ playground → http://localhost:${PORT}`);
  console.log(`▸ traces UI  → http://localhost:${PORT}${BASE_PATH}`);
});
