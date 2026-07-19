#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { breadcrumb } from "@breadcrumb-sh/core";
import { postgres, sqlite } from "@breadcrumb-sh/core/adapters";
import { toNodeHandler } from "@breadcrumb-sh/core/node";

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "dev":
    await dev(rest);
    break;
  case "migrate":
    await migrate(rest);
    break;
  default:
    console.log(`breadcrumb — embeddable LLM tracing

Usage:
  breadcrumb dev [--port 4106] [--db .breadcrumb/dev.db]   Standalone local server (SQLite + UI)
  breadcrumb migrate [--database <url|path>]               Apply schema (additive-only) to your DB
                                                           (defaults to $DATABASE_URL)`);
    process.exit(command ? 1 : 0);
}

async function migrate(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { database: { type: "string" } },
  });
  const target = values.database ?? process.env.DATABASE_URL;
  if (!target) {
    console.error("breadcrumb migrate: pass --database <url|path> or set DATABASE_URL.");
    process.exit(1);
  }

  const adapter = /^postgres(ql)?:/.test(target) ? postgres(target) : sqlite(target);
  console.log(`▸ migrating ${adapter.id} database…`);
  const result = await adapter.migrate();
  for (const table of result.createdTables) console.log(`  created table ${table}`);
  for (const column of result.addedColumns) console.log(`  added column ${column}`);
  if (result.createdTables.length === 0 && result.addedColumns.length === 0) {
    console.log("  already up to date");
  }
  await adapter.close?.();
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
