import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoutes, requireSession, requireApiKey } from "./auth/index.js";
import { trpcHandler } from "./trpc/index.js";
import { ingestRoutes } from "./ingest/index.js";
import { env } from "./env.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

// Auth routes (public)
app.route("/auth", authRoutes);

// SDK ingest (API key)
app.use("/v1/*", requireApiKey);
app.route("/v1", ingestRoutes);

// tRPC for web UI (session cookie)
app.use("/trpc/*", requireSession);
app.use("/trpc/*", trpcHandler);

// In production, serve the built web app
if (env.nodeEnv === "production") {
  app.use("/*", serveStatic({ root: "./public" }));
  app.use("/*", serveStatic({ path: "./public/index.html" }));
}

console.log(`server listening on port ${env.port}`);
serve({ fetch: app.fetch, port: env.port });
