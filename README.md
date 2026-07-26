# Breadcrumb

**See every step your AI takes.**

Breadcrumb is LLM tracing that lives in your backend. Traces land in your own
Postgres or SQLite, and the dashboard is a React component you mount inside your
own app. No platform, nothing leaving your stack.

```
Your app          Breadcrumb        Your database      Your app
emits spans   →   normalizes    →   stores traces  →   renders the UI
```

## Install

```bash
npm i @breadcrumb-sh/core pg                  # or better-sqlite3 for SQLite
npm i @breadcrumb-sh/react                    # the dashboard component
```

Create one instance and point it at your database:

```ts
// lib/breadcrumb.ts
import { breadcrumb } from "@breadcrumb-sh/core";
import { postgres } from "@breadcrumb-sh/core/adapters";

export const bc = breadcrumb({
  database: postgres(process.env.DATABASE_URL!),
  basePath: "/api/breadcrumb",
  authorize: (req) => isAdmin(req),
});
```

Mounting takes two routes: one for the API, one for the dashboard.

```ts
// app/api/breadcrumb/[...path]/route.ts
import { toNextHandler } from "@breadcrumb-sh/core/next";
import { bc } from "@/lib/breadcrumb";

export const { GET, POST, DELETE } = toNextHandler(bc);
```

```tsx
// app/traces/[[...slug]]/page.tsx
import { BreadcrumbDashboard } from "@breadcrumb-sh/react";

export default function TracesPage() {
  return <BreadcrumbDashboard api="/api/breadcrumb" basePath="/traces" />;
}
```

```tsx
// app/layout.tsx
import "@breadcrumb-sh/react/styles.css";
```

They are two routes because the Next App Router will not put a route handler and
a page on the same segment. The catch-all is what lets individual traces have
real, shareable URLs.

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
| [`@breadcrumb-sh/core`](packages/core) | Server SDK: tracing, the mountable handler, adapters, typed client, and the headless kit. |
| [`@breadcrumb-sh/react`](packages/react) | The dashboard component, plus the hooks it is built on. |
| [`@breadcrumb-sh/cli`](packages/cli) | `breadcrumb` CLI: schema migrations. |

Two runnable examples: [`examples/playground`](examples/playground) is an
offline demo of the server SDK that produces traces, and
[`examples/next`](examples/next) mounts the dashboard over them.

## Repo layout

This is an npm-workspaces monorepo (`packages/*`, `examples/*`).

```bash
npm install          # install all workspaces
npm run build        # core → cli → react
npm run typecheck
npm run test
```

To see the dashboard while working on it, run both examples: the playground
writes traces to SQLite, the Next app reads them.

```bash
npm run dev --workspace=examples/playground   # :4200, click to emit traces
npm run dev --workspace=examples/next         # :4300/traces
```

The Next example imports the *built* `@breadcrumb-sh/react`, so rebuild the
package to see changes. That is deliberate: bundling bugs (dropped side effects,
missing `"use client"`) only exist in the build.

## Releasing

Versioning and publishing run on [changesets](https://github.com/changesets/changesets).
Add a changeset for any user-facing change to `core`, `react`, or `cli`:

```bash
npx changeset
```

The example apps are ignored by changesets.

## License

MIT
