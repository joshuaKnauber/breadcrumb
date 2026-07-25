# playground

A runnable, offline demo of the Breadcrumb server SDK
([`@breadcrumb-sh/core`](../../packages/core)). It mounts the dashboard at
`/admin/traces` and exposes endpoints that produce traces, using a mock AI SDK
model so it runs with no API key.

## Run

From the monorepo root:

```bash
npm run dev --workspace=examples/playground
```

Then open:

- <http://localhost:4200> for the playground, with "run pipeline" and "run
  failing pipeline" buttons.
- <http://localhost:4200/admin/traces> for the dashboard.

Traces are stored in a SQLite file at `.breadcrumb/playground.db`, created on
startup.

## What it shows

- Creating a `breadcrumb()` instance with the `sqlite()` adapter and a `pricing`
  table.
- Mounting the handler with `toNodeHandler` on a plain Node HTTP server.
- Manual tracing with `bc.trace()` and nested `t.span()` (retrieval and tool
  spans).
- Vercel AI SDK integration via `bc.telemetry()`, with an offline mock model, so
  spans nest automatically through OpenTelemetry context.
- Cost from token usage, including cache-read discounts and reasoning tokens.
- A success path (`/run`) and an error path (`/run-error`), each calling
  `bc.flush()`.
