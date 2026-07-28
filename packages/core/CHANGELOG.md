# @breadcrumb-sh/core

## 0.2.0

### Minor Changes

- 51bbdd2: Trace reading, on several fronts.

  `maxPayloadChars` now spends its budget on the long strings inside a payload instead of flattening the whole thing into one truncated string. A capped message array stays an array of messages with shortened text, so a large prompt still renders as a conversation rather than as a JSON blob — which is what it did before, since the flattened form no longer parsed.

  The kit gains folding and a third view shape. `traceModel(spans, { collapsed })` hides a row's subtree, each row reports `hasChildren` / `collapsed` / `hiddenCount`, and `defaultCollapsed(spans, mode)` seeds the folded-on-arrival reading. `mode: "timeline"` (also `timelineRows`) returns flat rows ordered by start time, so steps that ran concurrently sit next to each other instead of in separate branches. `lastActivity(spans)` reports when a run last wrote a span.

  `traceModel` also reports `origin`, the run's wall-clock zero. It is the earliest span's start, not the root's — an orphan whose parent never arrived can begin before the root, and the waterfall was drawing it at a negative offset, off the left of the track.

  In the dashboard: flow and full tree open folded to the top level, with carets and `h`/`l` to fold and unfold; a Timeline view sits beside them, scrolling horizontally against a wall-clock axis with the name column pinned; a trace that wrote a span in the last 30 seconds polls every 5 seconds so a run in flight fills in live. The span inspector now leads with input and follows with output, both open, and renders structured payloads — tool arguments, tool results, object outputs — as a browsable tree rather than stringified JSON.

- 51bbdd2: Add `bc.spanProcessor`, an OpenTelemetry span processor for apps that already own a tracer provider (`@vercel/otel`, `NodeSDK`, Sentry). Register it and model spans reach breadcrumb without threading `bc.telemetry()` through every call — plain `experimental_telemetry: { isEnabled: true, functionId }` is enough.

  It writes through the same funnel as every other path (redact → payload cap → pricing), and stores only spans breadcrumb can read (`ai.*`, `gen_ai.*`, `breadcrumb.*`) so a shared provider's HTTP and filesystem spans don't land in the trace table. The new `shouldExport` option overrides that rule. `bc.telemetry()` keeps working alongside it, pinning breadcrumb's own tracer, so no span is written twice.

## 0.1.0

### Minor Changes

- Name and attribute runs by `functionId`, and stop degrading traces whose root span never arrives.

  - `functionId` is kept on every span it appears on, in a new `function_id` column, instead of being read once at the root and dropped everywhere else. **Existing databases need this column** — run `breadcrumb generate` and apply the migration (`migrations: "auto"` handles it for you).
  - A call is named after its `functionId` wherever it sits in the trace, not only when it is the root. Any other tracer above it (Sentry, Langfuse, an HTTP middleware) used to drop the run back to `ai.streamText`. Tool spans keep the tool's name, and the SDK's inner `.do*` spans keep theirs, so one call no longer reads as three identical rows.
  - Cost by function groups by `functionId`, falling back to the run's root-span name for spans that carry none. A run calling two functions now splits between them.
  - Traces whose parent span never reached breadcrumb keep their name and payload: the earliest surviving span acts as the root in the trace list, run feed and cost queries. In the waterfall, every disconnected subtree is rendered — previously only the first one was, and the rest were silently invisible — and the time axis spans the whole run.
  - `bc.telemetry()` takes `userId` and `sessionId` as named options, folded into telemetry metadata for the AI SDK. They were only reachable as magic `metadata` keys before. `functionId` is likewise settable on manual `bc.trace()`/`t.span()` attributes. `TelemetrySettings` no longer extends `TelemetryOptions`, so only what the AI SDK understands is passed to it.
