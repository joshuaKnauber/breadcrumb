# example-next

Mounts the Breadcrumb dashboard in a Next.js App Router app, over the database
[`examples/playground`](../playground) writes to. This is both the canonical
integration example and how the dashboard is developed.

## Run

From the monorepo root, run both apps:

```bash
npm run dev --workspace=examples/playground   # :4200, click to emit traces
npm run dev --workspace=examples/next         # :4300/traces
```

The playground has no traces on a fresh checkout, so click its buttons a few
times before the dashboard has anything to show.

This app imports the *built* `@breadcrumb-sh/react`, so rebuild after changing
it:

```bash
npm run build --workspace=@breadcrumb-sh/react
```

That is deliberate. Bundling bugs (a dropped side-effect import, a missing
`"use client"`, an export that is not server-safe) exist only in the build, and
importing source would hide them.

## What it shows

- **The two-route mount.** `app/api/breadcrumb/[...path]/route.ts` for the API,
  `app/traces/[[...slug]]/page.tsx` for the dashboard. Two routes because the
  App Router will not put a route handler and a page on the same segment.
- **Deep links.** The optional catch-all plus `basePath` gives every trace a
  shareable URL, and `initialRoute` makes the server render the right page
  instead of correcting itself after hydration.
- **A custom page.** `Evals.tsx` is mounted through `pages` and reads data with
  the same `useSessions` hook the built-in pages use.
