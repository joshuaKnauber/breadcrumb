# Breadcrumb

**See every step your AI takes.**

Breadcrumb is LLM tracing that lives in your backend. Traces land in your own
Postgres or SQLite, and a dashboard you serve from your own app. No platform,
nothing leaving your stack.

```
Your app          Breadcrumb        Your database      Your dashboard
emits spans   →   normalizes    →   stores traces  →   serves the UI
```

Your app emits spans, Breadcrumb normalizes and writes them to your database,
and the dashboard is served from your app. Every step stays inside your own
infrastructure.

## Install

```bash
npm i @breadcrumb-sh/core pg          # or better-sqlite3 for SQLite
```

Create one instance, point it at your database, and mount its handler:

```ts
// lib/breadcrumb.ts
import { breadcrumb } from "@breadcrumb-sh/core";
import { postgres } from "@breadcrumb-sh/core/adapters";

export const bc = breadcrumb({
  database: postgres(process.env.DATABASE_URL!),
  basePath: "/admin/traces",
  authorize: (req) => isAdmin(req),
});
```

```ts
// app/admin/traces/[[...breadcrumb]]/route.ts  (Next.js)
import { toNextHandler } from "@breadcrumb-sh/core/next";
import { bc } from "@/lib/breadcrumb";

export const { GET, POST } = toNextHandler(bc);
```

Then instrument your LLM calls, with the Vercel AI SDK or the manual `trace()`
API:

```ts
await bc.trace("support-reply", { userId }, async (t) => {
  t.set({ input: prompt });
  const answer = await callModel(prompt);
  t.set({ output: answer, model: "gpt-5", inputTokens, outputTokens });
});
```

Full walkthrough at [breadcrumb.sh/docs/quickstart](https://breadcrumb.sh/docs/quickstart).

## Packages

| Package | Description |
| --- | --- |
| [`@breadcrumb-sh/core`](packages/core) | Server SDK: tracing, the mountable handler, adapters, typed client, headless kit, and the baked-in dashboard. |
| [`@breadcrumb-sh/cli`](packages/cli) | `breadcrumb` CLI: a standalone local dev server and schema migrations. |
| [`@breadcrumb-sh/react`](packages/react) | React hooks for building a custom dashboard over your own data. |
| [`@breadcrumb-sh/ui`](packages/ui) | Private. The dashboard SPA, built and baked into `core`. |

The [`examples/playground`](examples/playground) app is a runnable, offline
demo of the server SDK.

## Repo layout

This is an npm-workspaces monorepo (`packages/*`, `examples/*`).

```bash
npm install          # install all workspaces
npm run build        # build ui → core → cli → react (in order)
npm run typecheck
npm run test
```

`ui` builds first because its output is baked into `core` at build time.

## Releasing

Versioning and publishing run on [changesets](https://github.com/changesets/changesets).
Add a changeset for any user-facing change to `core`, `cli`, or `react`:

```bash
npx changeset
```

The private `ui` and `playground` packages are ignored by changesets. Because
`ui` is baked into `core` at build time (not a package dependency), changes to
the dashboard should carry a changeset for `@breadcrumb-sh/core`.

## License

MIT
