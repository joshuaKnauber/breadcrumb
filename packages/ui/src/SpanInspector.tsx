import { useEffect, useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { fmtCost, fmtMs } from "./api.js";
import type { SpanRecord } from "./types.js";
import { asMessages, displayName, selfTime } from "@breadcrumb-sh/core/kit";
import { heatClass as heat } from "./TraceView.js";
import { ToggleGroup } from "./ui/ToggleGroup.js";

const MODES = [
  { value: "rendered" as const, label: "rendered" },
  { value: "raw" as const, label: "raw" },
];

/**
 * Outputs are what you judge; inputs are what you debug. The response leads at
 * reading size and the prompt collapses to one labelled row, so the common case
 * costs no scrolling and the debugging case costs one click.
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
  const [raw, setRaw] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);

  // A new selection is a fresh question: collapse back to the output.
  useEffect(() => {
    setInputOpen(false);
    setRaw(false);
  }, [span.id]);

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
    : span.input !== undefined && span.input !== null
      ? describePayload(span.input)
      : null;

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
          <Output span={span} messages={messages} />
          {inputSummary && (
            <>
              <button
                onClick={() => setInputOpen((v) => !v)}
                aria-expanded={inputOpen}
                className="flex w-full items-center gap-2.5 rounded-md border border-line bg-panel px-3 py-1.5 text-muted hover:border-line-strong hover:text-fg"
              >
                <span className="font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">
                  input
                </span>
                <span className="truncate font-mono text-[11px] tabular-nums">{inputSummary}</span>
                <span className="ml-auto text-faint">
                  {inputOpen ? (
                    <CaretDown size={10} weight="bold" />
                  ) : (
                    <CaretRight size={10} weight="bold" />
                  )}
                </span>
              </button>
              {inputOpen && (
                <div className="mt-2">
                  {messages ? (
                    messages.map((m, i) => <Message key={i} role={m.role} text={m.text} />)
                  ) : (
                    <Payload label="input" value={span.input} />
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Output({
  span,
  messages,
}: {
  span: SpanRecord;
  messages: ReturnType<typeof asMessages>;
}) {
  // A trailing assistant turn in the input array is the response for SDKs that
  // round-trip the whole conversation.
  const trailing = messages?.at(-1);
  const fromMessages =
    span.output === undefined || span.output === null
      ? trailing?.role === "assistant"
        ? trailing.text
        : null
      : null;

  const value = fromMessages ?? span.output;
  if (value === undefined || value === null) {
    return <div className="mb-3 text-[12.5px] text-faint">No output recorded for this step.</div>;
  }

  const text = typeof value === "string" ? value : null;
  return (
    <div className="mb-3.5">
      <span className="mb-1.5 block font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">
        output
      </span>
      {text !== null ? (
        <div className="text-[13.5px] leading-[1.65] whitespace-pre-wrap">{text}</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-panel px-3 py-2.5 font-mono text-[12px] whitespace-pre text-muted">
          {JSON.stringify(value, null, 1)}
        </div>
      )}
    </div>
  );
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

function describePayload(value: unknown): string {
  if (typeof value === "string") return `${value.length} chars`;
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object" && value !== null) {
    const n = Object.keys(value).length;
    return `${n} ${n === 1 ? "field" : "fields"}`;
  }
  return "payload";
}
