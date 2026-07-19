import type { OtelSpanData } from "./normalize.js";

/**
 * Parses an OTLP/HTTP JSON ExportTraceServiceRequest (protobuf JSON mapping)
 * into neutral span data. Covers what OTel SDK exporters actually send;
 * protobuf binary encoding can come later behind the same route.
 */

interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
}

interface KeyValue {
  key: string;
  value?: AnyValue;
}

function anyValue(value: AnyValue | undefined): unknown {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(anyValue);
  if (value.kvlistValue) return attrsToRecord(value.kvlistValue.values ?? []);
  return null;
}

function attrsToRecord(attrs: KeyValue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kv of attrs) out[kv.key] = anyValue(kv.value);
  return out;
}

/** Unix-nano timestamps exceed 2^53 — go through BigInt. */
function nanoToMs(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    return Number(BigInt(value) / 1_000_000n);
  } catch {
    return null;
  }
}

export function parseOtlpJson(body: unknown): OtelSpanData[] {
  const spans: OtelSpanData[] = [];
  const resourceSpans = (body as { resourceSpans?: unknown[] })?.resourceSpans;
  if (!Array.isArray(resourceSpans)) return spans;

  for (const rs of resourceSpans as {
    resource?: { attributes?: KeyValue[] };
    scopeSpans?: { spans?: Record<string, unknown>[] }[];
  }[]) {
    const resourceAttrs = attrsToRecord(rs.resource?.attributes ?? []);
    const environment =
      (resourceAttrs["deployment.environment.name"] as string | undefined) ??
      (resourceAttrs["deployment.environment"] as string | undefined);

    for (const scope of rs.scopeSpans ?? []) {
      for (const raw of scope.spans ?? []) {
        if (typeof raw.traceId !== "string" || typeof raw.spanId !== "string") continue;
        const startMs = nanoToMs(raw.startTimeUnixNano as string | number | undefined);
        if (startMs === null) continue;
        const status = raw.status as { code?: number | string; message?: string } | undefined;
        const isError = status?.code === 2 || status?.code === "STATUS_CODE_ERROR";
        spans.push({
          traceId: raw.traceId,
          spanId: raw.spanId,
          parentSpanId: typeof raw.parentSpanId === "string" && raw.parentSpanId !== "" ? raw.parentSpanId : null,
          name: typeof raw.name === "string" ? raw.name : "span",
          attributes: attrsToRecord((raw.attributes as KeyValue[] | undefined) ?? []),
          startMs,
          endMs: nanoToMs(raw.endTimeUnixNano as string | number | undefined),
          error: isError ? (status?.message ?? "") : null,
          ...(environment ? { environment } : {}),
        });
      }
    }
  }
  return spans;
}
