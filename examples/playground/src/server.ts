/**
 * Playground app: mounts breadcrumb at /admin/traces and exposes endpoints
 * that produce traces. Uses a mock AI SDK model, so it runs offline.
 *
 *   npm run dev --workspace=examples/playground
 */
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { generateText } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
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
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Offline mock model so the playground needs no API key.
const model: LanguageModelV2 = {
  specificationVersion: "v2",
  provider: "mock",
  modelId: "mock-gpt",
  supportedUrls: {},
  async doGenerate() {
    await sleep(150 + Math.random() * 400);
    const inputTokens = 80 + Math.floor(Math.random() * 200);
    const outputTokens = 20 + Math.floor(Math.random() * 120);
    return {
      finishReason: "stop",
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      content: [{ type: "text", text: "Die Antwort auf deine Frage ist 42." }],
      warnings: [],
    };
  },
  async doStream() {
    throw new Error("streaming not supported by the mock model");
  },
};

const USERS = ["anna", "ben", "carla"];

async function runPipeline(opts: { fail?: boolean } = {}): Promise<string> {
  const userId = USERS[Math.floor(Math.random() * USERS.length)]!;

  return bc.trace(
    "support-reply",
    { userId, sessionId: `session-${userId}`, metadata: { channel: "playground" } },
    async (t) => {
      const docs = await t.span(
        "retrieve-docs",
        { kind: "retrieval", input: { query: "wie funktioniert breadcrumb?" } },
        async (s) => {
          await sleep(50 + Math.random() * 100);
          if (opts.fail) throw new Error("vector index unavailable");
          const result = ["docs/setup.md", "docs/tracing.md"];
          s.set({ output: result });
          return result;
        }
      );

      // Nests under this trace automatically via OTel context propagation.
      const { text } = await generateText({
        model,
        prompt: `Beantworte mit Kontext aus: ${docs.join(", ")}`,
        experimental_telemetry: bc.telemetry({
          functionId: "generate-answer",
          metadata: { userId },
        }),
      });

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
