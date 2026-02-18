import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcHandler } from "./trpc/index.js";
import { ingestRoutes } from "./ingest/index.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

// REST ingest endpoint for SDKs
app.route("/v1", ingestRoutes);

// tRPC for web UI
app.use("/trpc/*", trpcHandler);

// In production, serve the built web app
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./public" }));
  app.use("/*", serveStatic({ path: "./public/index.html" }));
}

const port = Number(process.env.PORT) || 3100;
console.log(`server listening on port ${port}`);
serve({ fetch: app.fetch, port });
