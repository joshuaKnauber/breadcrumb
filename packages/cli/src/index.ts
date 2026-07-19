#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { breadcrumb } from "@breadcrumb-sh/core";
import { sqlite } from "@breadcrumb-sh/core/adapters";
import { toNodeHandler } from "@breadcrumb-sh/core/node";

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "dev":
    await dev(rest);
    break;
  case "migrate":
    console.error("breadcrumb migrate: not implemented yet — coming with the postgres adapter.");
    process.exit(1);
    break;
  default:
    console.log(`breadcrumb — embeddable LLM tracing

Usage:
  breadcrumb dev [--port 4106] [--db .breadcrumb/dev.db]   Standalone local server (SQLite + UI)
  breadcrumb migrate                                        Apply schema to your database`);
    process.exit(command ? 1 : 0);
}

async function dev(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string", default: "4106" },
      db: { type: "string", default: ".breadcrumb/dev.db" },
    },
  });
  const port = Number(values.port);
  const dbPath = resolve(values.db!);
  mkdirSync(dirname(dbPath), { recursive: true });

  const bc = breadcrumb({
    database: sqlite(dbPath),
    basePath: "/",
    environment: "development",
    // standalone dev server is local + unauthenticated by design
    ingest: { apiKey: "dev" },
  });

  const server = createServer(toNodeHandler(bc));
  server.listen(port, () => {
    console.log(`▸ breadcrumb dev server → http://localhost:${port}`);
    console.log(`▸ ingest (key: "dev")   → http://localhost:${port}/api/ingest/spans`);
    console.log(`▸ storage               → ${dbPath}`);
  });
}
