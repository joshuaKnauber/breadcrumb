import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFile } from "node:fs/promises";
import { authRoutes, requireSession, requireApiKey, requireMcpKey } from "./auth/index.js";
import { trpcHandler } from "./trpc/index.js";
import { ingestRoutes } from "./ingest/index.js";
import { runMigrations } from "./db/index.js";
import { runClickhouseMigrations } from "./db/clickhouse.js";
import { env } from "./env.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./mcp/index.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/auth", authRoutes);

app.use("/v1/*", requireApiKey);
app.route("/v1", ingestRoutes);

app.use("/trpc/*", requireSession);
app.use("/trpc/*", trpcHandler);

app.all("/mcp", requireMcpKey, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectId = (c as any).get("projectId") as string;
  const mcpServer = buildMcpServer(projectId);
  const transport = new StreamableHTTPTransport();
  await mcpServer.connect(transport);
  return transport.handleRequest(c);
});

if (env.nodeEnv === "production") {
  app.use("/*", serveStatic({ root: "./public" }));
  app.get("*", async (c) => {
    const html = await readFile("./public/index.html", "utf-8");
    return c.html(html);
  });
}

async function main() {
  await runMigrations();
  await runClickhouseMigrations();
  serve({ fetch: app.fetch, port: env.port });
  console.log(`server listening on port ${env.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
