---
"@breadcrumb-sh/core": minor
"@breadcrumb-sh/react": minor
---

Trace reading, on several fronts.

`maxPayloadChars` now spends its budget on the long strings inside a payload instead of flattening the whole thing into one truncated string. A capped message array stays an array of messages with shortened text, so a large prompt still renders as a conversation rather than as a JSON blob — which is what it did before, since the flattened form no longer parsed.

The kit gains folding and a third view shape. `traceModel(spans, { collapsed })` hides a row's subtree, each row reports `hasChildren` / `collapsed` / `hiddenCount`, and `defaultCollapsed(spans, mode)` seeds the folded-on-arrival reading. `mode: "timeline"` (also `timelineRows`) returns flat rows ordered by start time, so steps that ran concurrently sit next to each other instead of in separate branches. `lastActivity(spans)` reports when a run last wrote a span.

`traceModel` also reports `origin`, the run's wall-clock zero. It is the earliest span's start, not the root's — an orphan whose parent never arrived can begin before the root, and the waterfall was drawing it at a negative offset, off the left of the track.

In the dashboard: flow and full tree open folded to the top level, with carets and `h`/`l` to fold and unfold; a Timeline view sits beside them, scrolling horizontally against a wall-clock axis with the name column pinned; a trace that wrote a span in the last 30 seconds polls every 5 seconds so a run in flight fills in live. The span inspector now leads with input and follows with output, both open, and renders structured payloads — tool arguments, tool results, object outputs — as a browsable tree rather than stringified JSON.
