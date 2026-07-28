---
"@breadcrumb-sh/core": minor
---

Add `bc.spanProcessor`, an OpenTelemetry span processor for apps that already own a tracer provider (`@vercel/otel`, `NodeSDK`, Sentry). Register it and model spans reach breadcrumb without threading `bc.telemetry()` through every call — plain `experimental_telemetry: { isEnabled: true, functionId }` is enough.

It writes through the same funnel as every other path (redact → payload cap → pricing), and stores only spans breadcrumb can read (`ai.*`, `gen_ai.*`, `breadcrumb.*`) so a shared provider's HTTP and filesystem spans don't land in the trace table. The new `shouldExport` option overrides that rule. `bc.telemetry()` keeps working alongside it, pinning breadcrumb's own tracer, so no span is written twice.
