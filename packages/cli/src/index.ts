#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  planMigration,
  renderMigrationSql,
  EMPTY_SCHEMA_STATE,
  type Dialect,
  type DatabaseAdapter,
} from "@breadcrumb-sh/core";
import { postgres, sqlite } from "@breadcrumb-sh/core/adapters";

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "migrate":
    await migrate(rest);
    break;
  case "generate":
    await generate(rest);
    break;
  default:
    console.log(`breadcrumb — embeddable LLM tracing

Usage:
  breadcrumb migrate [--database <url|path>]               Apply schema directly to your DB
                                                           (defaults to $DATABASE_URL)
  breadcrumb generate [--database <url|path>]              Write a .sql migration file to review + apply
             [--dialect postgres|sqlite] [--out <dir>] [--name <name>]`);
    process.exit(command ? 1 : 0);
}

/** postgres:// connection string → postgres adapter; anything else → sqlite file. */
function adapterFor(target: string): DatabaseAdapter {
  return /^postgres(ql)?:/.test(target) ? postgres(target) : sqlite(target);
}

function dialectOf(adapter: DatabaseAdapter): Dialect {
  return adapter.id === "postgres" ? "postgres" : "sqlite";
}

async function migrate(args: string[]) {
  const { values } = parseArgs({ args, options: { database: { type: "string" } } });
  const target = values.database ?? process.env.DATABASE_URL;
  if (!target) {
    console.error("breadcrumb migrate: pass --database <url|path> or set DATABASE_URL.");
    process.exit(1);
  }

  const adapter = adapterFor(target);
  console.log(`▸ migrating ${adapter.id} database…`);
  const result = await adapter.migrate();
  for (const table of result.createdTables) console.log(`  created table ${table}`);
  for (const column of result.addedColumns) console.log(`  added column ${column}`);
  if (result.createdTables.length === 0 && result.addedColumns.length === 0) {
    console.log("  already up to date");
  }
  await adapter.close?.();
}

async function generate(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      database: { type: "string" },
      dialect: { type: "string" },
      out: { type: "string", default: "./breadcrumb/migrations" },
      name: { type: "string" },
    },
  });

  const target = values.database ?? process.env.DATABASE_URL;
  let dialect: Dialect;
  let state = EMPTY_SCHEMA_STATE;

  if (target) {
    // Diff against a live database, emitting only the delta.
    const adapter = adapterFor(target);
    dialect = dialectOf(adapter);
    state = await adapter.inspectSchema();
    await adapter.close?.();
  } else if (values.dialect === "postgres" || values.dialect === "sqlite") {
    // No connection: emit the full, fresh schema for the chosen dialect.
    dialect = values.dialect;
  } else {
    console.error(
      "breadcrumb generate: pass --database <url|path> to diff a live database, " +
        "or --dialect postgres|sqlite for a fresh schema."
    );
    process.exit(1);
  }

  const plan = planMigration(dialect, state);
  if (plan.statements.length === 0) {
    console.log("Schema already up to date — nothing to generate.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const fileName = `${stamp}_${values.name ?? "breadcrumb"}.sql`;
  const dir = resolve(values.out!);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, fileName);
  writeFileSync(filePath, renderMigrationSql(dialect, plan, new Date().toISOString()));

  console.log(`▸ wrote ${filePath} (${dialect})`);
  for (const table of plan.createdTables) console.log(`  create table ${table}`);
  for (const column of plan.addedColumns) console.log(`  add column ${column}`);
}

