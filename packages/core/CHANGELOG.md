# @breadcrumb-sh/core

## 0.1.0

### Minor Changes

- Name and attribute runs by `functionId`, and stop degrading traces whose root span never arrives.

  - `functionId` is kept on every span it appears on, in a new `function_id` column, instead of being read once at the root and dropped everywhere else. **Existing databases need this column** — run `breadcrumb generate` and apply the migration (`migrations: "auto"` handles it for you).
  - A call is named after its `functionId` wherever it sits in the trace, not only when it is the root. Any other tracer above it (Sentry, Langfuse, an HTTP middleware) used to drop the run back to `ai.streamText`. Tool spans keep the tool's name, and the SDK's inner `.do*` spans keep theirs, so one call no longer reads as three identical rows.
  - Cost by function groups by `functionId`, falling back to the run's root-span name for spans that carry none. A run calling two functions now splits between them.
  - Traces whose parent span never reached breadcrumb keep their name and payload: the earliest surviving span acts as the root in the trace list, run feed and cost queries. In the waterfall, every disconnected subtree is rendered — previously only the first one was, and the rest were silently invisible — and the time axis spans the whole run.
  - `bc.telemetry()` takes `userId` and `sessionId` as named options, folded into telemetry metadata for the AI SDK. They were only reachable as magic `metadata` keys before. `functionId` is likewise settable on manual `bc.trace()`/`t.span()` attributes. `TelemetrySettings` no longer extends `TelemetryOptions`, so only what the AI SDK understands is passed to it.
