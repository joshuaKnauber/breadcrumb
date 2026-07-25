# @breadcrumb-sh/react

React hooks for building a custom [Breadcrumb](https://breadcrumb.sh) tracing UI
over your own data. Thin wrappers over
[TanStack Query](https://tanstack.com/query) against the same contract as the
server SDK's `bc.api`, served over HTTP by `@breadcrumb-sh/core`.

## Install

```bash
npm i @breadcrumb-sh/react
```

`react >=18` and `@tanstack/react-query >=5` are peer dependencies.

## Setup

Wrap your dashboard in a `BreadcrumbProvider`, inside your own
`QueryClientProvider`. `basePath` must match where the Breadcrumb handler is
mounted on your server:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { BreadcrumbProvider, useSessions, useStats } from "@breadcrumb-sh/react";

function App() {
  return (
    <QueryClientProvider client={qc}>
      <BreadcrumbProvider basePath="/admin/traces">
        <Dashboard />
      </BreadcrumbProvider>
    </QueryClientProvider>
  );
}

function Dashboard() {
  const { data: stats } = useStats({ since: Date.now() - 7 * 864e5 });
  const { data } = useSessions({ environment: "production" });
  // …render it however your product looks.
}
```

The provider accepts `BreadcrumbClientOptions` (`basePath`, `fetch`, `headers`),
or a preconfigured `client` prop built with `createBreadcrumbClient`.

## Hooks

Each hook takes the same filters as `bc.api` plus an optional TanStack Query
options object, and returns a `UseQueryResult`.

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

`useBreadcrumbClient()` returns the underlying client for imperative calls
outside hooks. `createBreadcrumbClient`, `BreadcrumbClient`, and
`BreadcrumbClientOptions` are re-exported from `@breadcrumb-sh/core/client`.

To render spans, pair these with the headless kit in
[`@breadcrumb-sh/core/kit`](../core) (`flowRows`, `selfTime`, `asMessages`, `fmtCost`, …).

## License

MIT
