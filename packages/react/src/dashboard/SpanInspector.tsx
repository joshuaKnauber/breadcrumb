import { useState, type ReactNode } from "react";
import { CaretDown, CaretRight } from "./ui/icons.js";
import { fmtCost, fmtMs } from "@breadcrumb-sh/core/kit";
import type { SpanRecord } from "@breadcrumb-sh/core/client";
import { asMessages, displayName, selfTime } from "@breadcrumb-sh/core/kit";
import { heatFill as heat } from "./TraceView.js";
import { JsonView } from "./ui/JsonView.js";
import { ToggleGroup } from "./ui/ToggleGroup.js";

const MODES = [
  { value: "rendered" as const, label: "rendered" },
  { value: "raw" as const, label: "raw" },
];

/**
 * A step reads in the order it ran: what went in, then what came back. Both are
 * open on arrival — a tool call's arguments are the reason you clicked it — and
 * each section folds away when it's the other one you're chasing.
 */
export function SpanInspector({
  span,
  kids,
  total,
  maxSelf,
}: {
  span: SpanRecord;
  kids: SpanRecord[];
  total: number;
  maxSelf: number;
}) {
  // A new selection remounts this panel (it's keyed on the span), so every
  // fold below starts fresh rather than inheriting the last span's state.
  const [raw, setRaw] = useState(false);

  const ms = (span.endTime ?? span.startTime) - span.startTime;
  const self = selfTime(span, kids);
  const share = Math.round((self / total) * 100);
  const messages = asMessages(span.input);

  const tokenParts = [
    span.cachedInputTokens ? `${fmtNum(span.cachedInputTokens)} cached` : null,
    span.reasoningTokens ? `${fmtNum(span.reasoningTokens)} reasoning` : null,
  ].filter(Boolean);

  const stats = [
    span.model,
    span.inputTokens != null
      ? `${fmtNum(span.inputTokens)}→${fmtNum(span.outputTokens ?? 0)} tok`
      : null,
    span.cost != null ? fmtCost(span.cost) : null,
    fmtMs(ms),
  ]
    .filter(Boolean)
    .join(" · ");

  const inputSummary = messages
    ? `${messages.length} ${messages.length === 1 ? "message" : "messages"}${
        span.inputTokens != null ? ` · ${fmtNum(span.inputTokens)} tok` : ""
      }${tokenParts.length ? ` · ${tokenParts.join(", ")}` : ""}`
    : describePayload(span.input);

  // A trailing assistant turn in the input array is the response for SDKs that
  // round-trip the whole conversation.
  const trailing = messages?.at(-1);
  const output =
    span.output ??
    (trailing?.role === "assistant" ? trailing.text : undefined);

  return (
    <div className="px-4 pt-3.5 pb-6">
      <div className="mb-1 flex items-baseline gap-2.5">
        <h2 className="text-[13.5px] font-semibold">{displayName(span)}</h2>
        <ToggleGroup
          ariaLabel="Payload rendering"
          className="ml-auto"
          value={raw ? "raw" : "rendered"}
          options={MODES}
          onChange={(v) => setRaw(v === "raw")}
        />
      </div>
      <div className="mb-3 font-mono text-[11px] text-muted tabular-nums">{stats || span.kind}</div>

      {span.error && (
        <div className="mb-3 rounded-r-[5px] border-l-2 border-err bg-err/10 px-3 py-2">
          <div className="mb-1 font-mono text-[11px] text-err">failed after {fmtMs(ms)}</div>
          <div className="font-mono text-[11.5px] break-words text-fg">{span.error}</div>
        </div>
      )}

      <div className="mb-3.5 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-md border border-line bg-panel px-3 py-2">
        <span className="font-mono text-[10px] tracking-wider text-faint uppercase">self time</span>
        <span className="h-[5px] overflow-hidden rounded-[3px] bg-raised">
          <span
            className={`block h-full rounded-[3px] ${heat(span, self, total, maxSelf)}`}
            style={{ width: `${Math.max(share, 1)}%` }}
          />
        </span>
        <span className="font-mono text-[11px] text-fg tabular-nums">
          {fmtMs(self)} · {share}% of run
        </span>
      </div>

      {raw ? (
        <>
          <Payload label="input" value={span.input} />
          <Payload label="output" value={span.output} />
          {span.metadata && <Payload label="metadata" value={span.metadata} />}
        </>
      ) : (
        <>
          <Section label="input" summary={inputSummary}>
            {messages ? (
              messages.map((m, i) => <Message key={i} role={m.role} text={m.text} />)
            ) : (
              <Rendered value={span.input} />
            )}
          </Section>
          <Section label="output" summary={describePayload(output)}>
            <Rendered value={output} prose />
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (summary === null) {
    return (
      <div className="mb-3.5">
        <SectionLabel>{label}</SectionLabel>
        <div className="text-[12.5px] text-faint">Nothing recorded for this step.</div>
      </div>
    );
  }
  return (
    <div className="mb-3.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-1.5 flex w-full items-center gap-2 text-faint hover:text-fg"
      >
        <SectionLabel>{label}</SectionLabel>
        <span className="truncate font-mono text-[10.5px] tabular-nums">{summary}</span>
        <span className="ml-auto">{open ? <CaretDown size={10} /> : <CaretRight size={10} />}</span>
      </button>
      {open && children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">{children}</span>
  );
}

/** Strings read as text; anything structured gets the browsable tree. */
function Rendered({ value, prose = false }: { value: unknown; prose?: boolean }) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    return (
      <div
        className={`whitespace-pre-wrap ${
          prose ? "text-[13.5px] leading-[1.65]" : "text-[12.5px] leading-[1.6] text-muted"
        }`}
      >
        {value}
      </div>
    );
  }
  return <JsonView value={value} />;
}

function Message({ role, text }: { role: string; text: string }) {
  const [open, setOpen] = useState(role !== "system");
  const collapsible = role === "system";
  return (
    <div className="mb-2 overflow-hidden rounded-md border border-line bg-panel">
      <button
        onClick={() => collapsible && setOpen((v) => !v)}
        className={`flex w-full gap-2 px-3 pt-1.5 pb-1 font-mono text-[9.5px] tracking-[0.12em] uppercase ${
          collapsible ? "" : "cursor-default"
        }`}
      >
        <span className="text-muted">{role}</span>
        {collapsible && <span className="ml-auto text-faint">{open ? "collapse" : "expand"}</span>}
      </button>
      <div
        className={`px-3 pb-2.5 text-[12.5px] leading-[1.6] whitespace-pre-wrap text-muted ${
          open ? "" : "max-h-[3.2em] overflow-hidden"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="mb-2 overflow-x-auto rounded-md border border-line bg-panel px-3 py-2 font-mono text-[11.5px] text-muted">
      <b className="font-medium text-fg">{label}</b>{" "}
      <span className="whitespace-pre-wrap">{JSON.stringify(value, null, 1)}</span>
    </div>
  );
}

function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** null means nothing was recorded — the section says so instead of rendering. */
function describePayload(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return `${value.length} chars`;
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") {
    const n = Object.keys(value).length;
    return `${n} ${n === 1 ? "field" : "fields"}`;
  }
  return "payload";
}
