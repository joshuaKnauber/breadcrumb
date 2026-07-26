# @breadcrumb-sh/react

The [Breadcrumb](https://breadcrumb.sh) tracing dashboard as a React component,
plus the hooks it is built on for anyone assembling their own.

```bash
npm i @breadcrumb-sh/react
```

`react >=18` and `react-dom >=18` are peer dependencies. Everything else ships
with the package.

## Mounting the dashboard

The dashboard is a component you render inside your own app, so it inherits your
auth, your layout and your deployment. It needs two routes: one for the API,
one for the page.

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
  return (
    <div style={{ height: "100dvh" }}>
      <BreadcrumbDashboard api="/api/breadcrumb" basePath="/traces" />
    </div>
  );
}
```

```tsx
// app/layout.tsx — once, anywhere above the dashboard
import "@breadcrumb-sh/react/styles.css";
```

Two routes because the Next App Router will not put a route handler and a page
on the same segment. The optional catch-all is what lets `basePath` give
individual traces real, shareable URLs.

The component fills its container, so give it one with a height.

## Props

| Prop | Description |
| --- | --- |
| `api` | Where the handler is mounted, e.g. `/api/breadcrumb`. |
| `basePath` | Where this page is mounted. Turns on address-bar sync; needs a catch-all route. |
| `initialRoute` | The route to render before the address bar is read. See below. |
| `route` / `onNavigate` | Controlled routing: you own the route and map it to your own router. |
| `hide` | Pages and chrome to leave out: any page name plus `sidebar`, `theme`. |
| `pages` | Extra pages, listed in the sidebar after the built-in ones. |
| `theme` | `light`, `dark` or `system` to follow your app's theme; omit for a built-in toggle. |
| `client` | A preconfigured `BreadcrumbClient`, for custom `fetch` or auth headers. |
| `queryClient` | Reuse an existing `QueryClient` instead of the dashboard's own. |

Routing has three modes, in order of how much you want to care. With neither
`basePath` nor `route`, the route lives in component state and your URL is never
touched. With `basePath`, it syncs to the address bar. With `route` and
`onNavigate`, you own it entirely.

### Server rendering

The dashboard reads the address bar after mount, so a deep link server-renders
the session list for one frame before correcting itself. Pass `initialRoute` to
close that gap:

```tsx
import { parseRoute } from "@breadcrumb-sh/react/routing";

const { slug } = await params;
<BreadcrumbDashboard
  api="/api/breadcrumb"
  basePath="/traces"
  initialRoute={parseRoute(`/${(slug ?? []).join("/")}`)}
/>;
```

`parseRoute` lives on its own entry point because the main one is marked
`"use client"`, and a server component cannot call into a client module.

## Adding pages

A page gets a nav entry, a URL, and the same data access the built-in pages
have:

```tsx
<BreadcrumbDashboard
  api="/api/breadcrumb"
  hide={["cost"]}
  pages={[{ name: "evals", label: "Evals", element: <Evals /> }]}
/>
```

```tsx
"use client";
import { useSessions } from "@breadcrumb-sh/react";

export function Evals() {
  const { data } = useSessions();
  const failing = (data?.items ?? []).filter((s) => s.errorCount > 0);
  // …render it however your product looks.
}
```

`element` is an element rather than a render function so a server component can
pass it across the boundary. Your page renders inside the dashboard's style
scope, so its design tokens (`bg-panel`, `text-faint`, `border-line`) are
available to you.

## Hooks

The dashboard is built on these, so anything it can show, you can build. Each
takes the same filters as `bc.api` plus an optional TanStack Query options
object, and returns a `UseQueryResult`.

| Hook | Returns |
| --- | --- |
| `useSessions(filter?)` | A page of session summaries. |
| `useTraces(filter?)` | A page of trace summaries. |
| `useRuns(sessionKey)` | Runs for a session. |
| `useTrace(traceId)` | Spans for a trace (no-ops on `null`). |
| `useSpan(id)` | A single span (no-ops on `null`). |
| `useCost({ days?, environment? })` | Cost summary. |
| `useStats(filter?)` | Run count, error rate, cost, tokens, latency. |
| `useEnvironments()` | Known environment names. |
| `useMcpKeys()` | MCP keys plus the server name for connect snippets. |
| `useCreateMcpKey()` / `useRevokeMcpKey()` | Mutations for the same. |

Used inside `<BreadcrumbDashboard>` they need no setup. To build a UI from
scratch instead, wrap it yourself:

```tsx
<QueryClientProvider client={qc}>
  <BreadcrumbProvider basePath="/api/breadcrumb">
    <YourDashboard />
  </BreadcrumbProvider>
</QueryClientProvider>
```

`useBreadcrumbClient()` returns the underlying client for imperative calls. To
render spans, pair these with the headless kit in
[`@breadcrumb-sh/core/kit`](../core) (`traceModel`, `flowRows`, `selfTime`,
`asMessages`, `fmtCost`, …), which is what the waterfall here uses.

## Styling

The stylesheet is scoped: every rule sits under `.bc-root`, so it cannot reach
your app and your own utility classes cannot collide with its. Tailwind's
Preflight is deliberately not included, since it resets `*` and `body`.

Colours come from CSS custom properties on the dashboard root, so you can
override them:

```css
.bc-root {
  --color-panel: #fff;
  --color-err: #b91c1c;
}
```

Dark mode follows the OS unless the built-in toggle sets it, or you pass
`theme`. The attribute is stamped on the dashboard's own root, never on `<html>`.

## License

MIT
