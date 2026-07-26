# @breadcrumb-sh/core

Embeddable LLM tracing for TypeScript apps. Your database, your deployment, your UI.

Breadcrumb captures your LLM calls (tokens, model, cost, cached and reasoning
tokens), nests spans into traces, and writes them to your own SQLite or
Postgres. You mount a fetch-native handler into your app and render the
dashboard from [`@breadcrumb-sh/react`](../react), or build your own UI on the
headless API here. Built on OpenTelemetry, with native support for the Vercel
AI SDK.

## Install

```bash
npm i @breadcrumb-sh/core pg              # Postgres
npm i @breadcrumb-sh/core better-sqlite3  # SQLite
```

`pg` and `better-sqlite3` are optional peer dependencies. Install only the
driver for the database you use.

## Setup

Create one instance and mount its handler:

```ts
// lib/breadcrumb.ts
import { breadcrumb } from "@breadcrumb-sh/core";
import { postgres } from "@breadcrumb-sh/core/adapters";

export const bc = breadcrumb({
  database: postgres(process.env.DATABASE_URL!),
  basePath: "/admin/traces",
  authorize: (req) => isAdmin(req),
  pricing: { "gpt-5": { input: 1.25, output: 10, cachedInput: 0.125 } },
});
```

Mount `bc.handler` (a `(request: Request) => Promise<Response>`) at `basePath`.
Framework bridges are provided:

```ts
// Next.js: app/admin/traces/[[...breadcrumb]]/route.ts
import { toNextHandler } from "@breadcrumb-sh/core/next";
export const { GET, POST } = toNextHandler(bc);

// Node / Express
import { toNodeHandler } from "@breadcrumb-sh/core/node";
app.use("/admin/traces", toNodeHandler(bc));

// Anything fetch-native (Hono, SvelteKit, …)
app.all("/admin/traces/*", (c) => bc.handler(c.req.raw));
```

The schema is created automatically in development (`migrations: "auto"`). For
production, generate migration files with the [CLI](../cli) and set
`migrations: "manual"`.

## Instrumenting calls

**Vercel AI SDK.** `bc.telemetry()` returns settings for `experimental_telemetry`.
Calls made inside a `bc.trace()` callback nest into the same trace automatically:

```ts
import { generateText } from "ai";

const { text } = await generateText({
  model: openai("gpt-5"),
  prompt,
  experimental_telemetry: bc.telemetry({ functionId: "generate-answer" }),
});
```

**Manual tracing.** `bc.trace(name, attrs?, fn)`, with nested `t.span(...)`:

```ts
await bc.trace("support-reply", { userId }, async (t) => {
  t.set({ input: prompt });
  const docs = await t.span("retrieve", { kind: "retrieval" }, async (s) => {
    const result = await search(prompt);
    s.set({ output: result });
    return result;
  });
  const answer = await callModel(prompt, docs);
  t.set({ output: answer, model: "gpt-5", inputTokens, outputTokens });
});
```

`t.set()` accepts `model`, `provider`, `input`/`output`, token counts
(`inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`,
`reasoningTokens`), an explicit `cost`, and `metadata`. A thrown error marks the
span failed and rethrows.

On serverless or edge, call `await bc.flush()` (or `waitUntil(bc.flush())`)
before the response returns so no spans are lost. Set `flushMode: "sync"` for
those runtimes.

## Entry points

| Import | Exports |
| --- | --- |
| `@breadcrumb-sh/core` | `breadcrumb()`, the `Breadcrumb` type, migration helpers (`planMigration`, `renderMigrationSql`, `EMPTY_SCHEMA_STATE`), and the full domain type contract. |
| `@breadcrumb-sh/core/adapters` | `sqlite(fileOrDb)`, `postgres(connectionOrClient)`. |
| `@breadcrumb-sh/core/client` | `createBreadcrumbClient()`, a typed browser fetch client mirroring `bc.api`. |
| `@breadcrumb-sh/core/kit` | Headless UI helpers: `traceModel`, `flowRows`, `selfTime`, `hotspots`, `asMessages`, `preview`, and formatters (`fmtCost`, `fmtTokens`, `fmtMs`, …). |
| `@breadcrumb-sh/core/node` | `toNodeHandler()` for Node/Express. |
| `@breadcrumb-sh/core/next` | `toNextHandler()` for the Next.js App Router. |

## Building your own dashboard

The server, the browser client, and the React hooks share one contract. Query
the server directly from a React Server Component with `bc.api` (`listTraces`,
`listSessions`, `getTrace`, `stats`, `costSummary`, …), use the typed client in
the browser, or reach for [`@breadcrumb-sh/react`](../react) hooks. Render with
the headless kit:

```ts
import { traceModel, selfTime, asMessages, fmtCost } from "@breadcrumb-sh/core/kit";

const model = traceModel(spans);      // rows, scales, hotspots, totals
model.rows;                            // denoised, depth-indexed, ready to map
model.spots;                           // { errorId, slowestId, costliestId }
selfTime(span, children);              // extent minus what the children covered
const chat = asMessages(span.input);   // parse chat-shaped payloads
fmtCost(0.0042);                       // "$0.0042"
```

`traceModel` is what the shipped waterfall renders from, so a UI you build from
scratch reads exactly the same numbers rather than reimplementing them.

## Configuration

Key `breadcrumb()` options:

| Option | Default | Purpose |
| --- | --- | --- |
| `database` | required | A `sqlite()` or `postgres()` adapter. |
| `basePath` | `/breadcrumb` | Where the handler is mounted. |
| `environment` | `VERCEL_ENV ?? NODE_ENV ?? development` | Stamped on every span. |
| `authorize` | none | Guards the UI and query routes. |
| `ingest` | none | `{ apiKey }` enables HTTP ingest endpoints. |
| `pricing` | none | USD per 1M tokens, keyed by model, for cost. |
| `retention` | 90d | Per-environment retention windows. |
| `redact` | none | Scrub or trim each span before storage. |
| `maxPayloadChars` | `16384` | Truncate captured input/output (`0` disables). |
| `flushMode` | `batch` | `sync` for serverless/edge. |
| `migrations` | `auto` | `manual` runs no runtime DDL. |

Breadcrumb ships no default prices. Omit `pricing` and only costs you set
yourself are stored. See the full reference at
[breadcrumb.sh/docs/configuration](https://breadcrumb.sh/docs/configuration).

## License

MIT
