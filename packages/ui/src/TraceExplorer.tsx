import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtCost, fmtMs } from "./api.js";
import type { SpanRecord } from "./types.js";
import { asMessages, buildTree, errorPaths, type TreeNode } from "./tree.js";

const KIND_STYLES: Record<string, string> = {
  llm: "text-accent bg-accent/10",
  retrieval: "text-blue bg-blue/10",
  tool: "text-purple bg-purple/10",
  embedding: "text-blue bg-blue/10",
  agent: "text-ok bg-ok/10",
  span: "text-muted bg-panel2",
  group: "text-faint bg-panel2",
};

export function TraceExplorer({
  traceId,
  jumpToError,
  onClose,
}: {
  traceId: string | null;
  jumpToError: boolean;
  onClose: () => void;
}) {
  const spansQuery = useQuery({
    queryKey: ["trace", traceId],
    queryFn: () => api.trace(traceId!),
    enabled: traceId !== null,
  });
  const spans = traceId ? (spansQuery.data ?? []) : [];

  const tree = useMemo(() => buildTree(spans), [spans]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // On opening a failed run: expand the error path, select the failing span.
  useEffect(() => {
    if (!traceId || spans.length === 0) return;
    if (jumpToError) {
      const { expandKeys, firstErrorId } = errorPaths(spans);
      setExpanded(expandKeys);
      setSelectedId(firstErrorId);
    } else {
      setExpanded(new Set());
      setSelectedId(spans.find((s) => asMessages(s.input)) ? null : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceId, spans.length === 0]);

  const selected = spans.find((s) => s.id === selectedId) ?? null;
  const root = spans.find((s) => !s.parentSpanId);
  const totalMs =
    root?.endTime != null ? root.endTime - root.startTime : null;

  if (!traceId) return <aside className="w-0 flex-none overflow-hidden border-l border-line transition-[width]" />;

  return (
    <aside className="flex w-[520px] flex-none flex-col overflow-hidden border-l border-line">
      <div className="flex w-[520px] flex-none items-baseline gap-2.5 border-b border-line px-4 py-3">
        <h2 className="font-semibold">{root?.name ?? "trace"}</h2>
        <span className="font-mono text-[11px] text-muted">
          {spans.length} steps · {fmtMs(totalMs)}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded-[5px] border border-line px-2 py-0.5 font-mono text-xs text-faint hover:text-muted"
        >
          esc
        </button>
      </div>

      <div className="max-h-[46%] w-[520px] flex-none overflow-y-auto border-b border-line p-2">
        {spansQuery.isLoading && <div className="p-2 text-faint">loading…</div>}
        <Tree
          nodes={tree}
          depth={0}
          expanded={expanded}
          selectedId={selectedId}
          onToggle={(key) =>
            setExpanded((cur) => {
              const next = new Set(cur);
              next.has(key) ? next.delete(key) : next.add(key);
              return next;
            })
          }
          onSelect={setSelectedId}
        />
      </div>

      <div className="w-[520px] flex-1 overflow-y-auto px-4 pt-3 pb-8">
        {selected ? (
          <SpanDetail span={selected} />
        ) : (
          <div className="p-2 text-[12.5px] text-faint">Select a step to inspect its prompt or payload.</div>
        )}
      </div>
    </aside>
  );
}

function Tree({
  nodes,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  onToggle: (key: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === "group") {
          const key = `g:${node.spans[0]!.id}`;
          const open = expanded.has(key);
          return (
            <div key={key}>
              <button
                onClick={() => onToggle(key)}
                className="grid w-full grid-cols-[14px_62px_1fr_auto] items-center gap-2 rounded-[5px] px-1.5 py-1 text-[12.5px] hover:bg-panel"
                style={{ marginLeft: depth * 14 }}
              >
                <span className="text-center font-mono text-[10px] text-faint">{open ? "▾" : "▸"}</span>
                <span className={`rounded px-1 py-0.5 text-center font-mono text-[9.5px] tracking-wide uppercase ${KIND_STYLES.group}`}>
                  ×{node.stats.count}
                </span>
                <span className={`truncate ${node.stats.hasError ? "text-err" : ""}`}>
                  {node.name} <span className="text-faint">({node.stats.count})</span>
                </span>
                <span className="font-mono text-[10.5px] text-faint tabular-nums">
                  {fmtMs(node.stats.totalMs)}
                  {node.stats.cost != null ? ` · ${fmtCost(node.stats.cost)}` : ""}
                </span>
              </button>
              {open &&
                node.spans.map((s, j) => (
                  <div key={s.id}>
                    <SpanRow
                      span={s}
                      depth={depth + 1}
                      hasKids={node.children[j]!.length > 0}
                      open={expanded.has(s.id)}
                      selected={selectedId === s.id}
                      onToggle={onToggle}
                      onSelect={onSelect}
                    />
                    {expanded.has(s.id) && (
                      <Tree
                        nodes={node.children[j]!}
                        depth={depth + 2}
                        expanded={expanded}
                        selectedId={selectedId}
                        onToggle={onToggle}
                        onSelect={onSelect}
                      />
                    )}
                  </div>
                ))}
            </div>
          );
        }
        const s = node.span;
        return (
          <div key={s.id}>
            <SpanRow
              span={s}
              depth={depth}
              hasKids={node.children.length > 0}
              open={expanded.has(s.id)}
              selected={selectedId === s.id}
              onToggle={onToggle}
              onSelect={onSelect}
            />
            {node.children.length > 0 && expanded.has(s.id) && (
              <Tree
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selectedId={selectedId}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function SpanRow({
  span,
  depth,
  hasKids,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  span: SpanRecord;
  depth: number;
  hasKids: boolean;
  open: boolean;
  selected: boolean;
  onToggle: (key: string) => void;
  onSelect: (id: string) => void;
}) {
  const ms = span.endTime != null ? span.endTime - span.startTime : null;
  return (
    <button
      onClick={() => {
        if (hasKids) onToggle(span.id);
        onSelect(span.id);
      }}
      aria-selected={selected}
      className={`grid w-full grid-cols-[14px_62px_1fr_auto] items-center gap-2 rounded-[5px] px-1.5 py-1 text-[12.5px] ${
        selected ? "bg-panel2" : "hover:bg-panel"
      }`}
      style={{ marginLeft: depth * 14 }}
    >
      <span className="text-center font-mono text-[10px] text-faint">{hasKids ? (open ? "▾" : "▸") : ""}</span>
      <span className={`rounded px-1 py-0.5 text-center font-mono text-[9.5px] tracking-wide uppercase ${KIND_STYLES[span.kind] ?? KIND_STYLES.span}`}>
        {span.kind}
      </span>
      <span className={`truncate ${span.status === "error" ? "text-err" : ""}`}>{span.name}</span>
      <span className="font-mono text-[10.5px] text-faint tabular-nums">
        {fmtMs(ms)}
        {span.model ? ` · ${span.model}` : ""}
      </span>
    </button>
  );
}

function SpanDetail({ span }: { span: SpanRecord }) {
  const [showRaw, setShowRaw] = useState(false);
  const messages = asMessages(span.input);
  const stats = [
    span.model,
    span.inputTokens != null ? `${span.inputTokens}→${span.outputTokens ?? 0} tok` : null,
    span.cost != null ? fmtCost(span.cost) : null,
    span.endTime != null ? fmtMs(span.endTime - span.startTime) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2.5">
        <h3 className="text-[13px] font-semibold">{span.name}</h3>
        <span className="font-mono text-[11px] text-muted">{stats}</span>
        <button
          onClick={() => setShowRaw((v) => !v)}
          className={`ml-auto rounded-[5px] border border-line px-2 py-0.5 font-mono text-[11px] ${showRaw ? "text-fg" : "text-faint"}`}
        >
          raw
        </button>
      </div>

      {span.error && (
        <div className="mb-2 rounded-lg border border-err/40 bg-err/10 px-3 py-2 font-mono text-xs text-err">
          ✗ {span.error}
        </div>
      )}

      {showRaw ? (
        <>
          <Payload label="input" value={span.input} />
          <Payload label="output" value={span.output} />
          {span.metadata && <Payload label="metadata" value={span.metadata} />}
        </>
      ) : messages ? (
        <>
          {messages.map((m, i) => (
            <Message key={i} role={m.role} text={m.text} />
          ))}
          {span.output !== undefined && span.output !== null && !messages.some((m) => m.role === "assistant") && (
            <Message role="assistant" text={typeof span.output === "string" ? span.output : JSON.stringify(span.output, null, 1)} />
          )}
        </>
      ) : (
        <>
          <Payload label="input" value={span.input} />
          <Payload label="output" value={span.output} />
        </>
      )}
    </div>
  );
}

const ROLE_COLORS: Record<string, string> = {
  system: "text-faint",
  user: "text-blue",
  assistant: "text-accent",
  tool: "text-purple",
};

function Message({ role, text }: { role: string; text: string }) {
  const [open, setOpen] = useState(role !== "system");
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-line">
      <button
        onClick={() => role === "system" && setOpen((v) => !v)}
        className={`flex w-full bg-panel px-3 py-1.5 font-mono text-[10px] tracking-wider uppercase ${role === "system" ? "" : "cursor-default"}`}
      >
        <span className={ROLE_COLORS[role] ?? "text-muted"}>{role}</span>
        {role === "system" && <span className="ml-auto text-faint">{open ? "collapse" : "expand"}</span>}
      </button>
      <div
        className={`px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
          role === "system" ? `text-muted ${open ? "" : "max-h-[3.1em] overflow-hidden text-ellipsis"}` : ""
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
    <div className="mb-2 overflow-x-auto rounded-md bg-panel px-3 py-2 font-mono text-xs text-muted">
      <b className="font-medium text-purple">{label}</b>{" "}
      <span className="whitespace-pre-wrap">{JSON.stringify(value, null, 1)}</span>
    </div>
  );
}
