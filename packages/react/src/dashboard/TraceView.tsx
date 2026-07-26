"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { CaretDown, CaretRight, XCircle } from "@phosphor-icons/react";
import type { SpanRecord } from "@breadcrumb-sh/core/client";
import {
  defaultSelection,
  displayName,
  extent,
  fmtCost,
  fmtMs,
  fmtTokens,
  heatLevel,
  keyboardTarget,
  selfIntervals,
  selfTime,
  traceModel,
  type HeatLevel,
  type Hotspots,
  type TraceRow,
  type TraceTotals,
  type TraceViewMode,
} from "@breadcrumb-sh/core/kit";
import { useTrace } from "../hooks.js";
import { RouteLink, useNavigation } from "./navigation.js";
import { usePortalContainer } from "./root.js";
import { SpanInspector } from "./SpanInspector.js";
import { ToggleGroup } from "./ui/ToggleGroup.js";
import { Loading, Skeleton } from "./ui/Skeleton.js";

const VIEWS = [
  { value: "flow" as const, label: "Flow" },
  { value: "full" as const, label: "Full tree" },
];

export function TraceView() {
  const { route, go } = useNavigation();
  const traceId = route.traceId ?? "";
  const sessionKey = route.sessionKey;
  const view: TraceViewMode = route.view === "full" ? "full" : "flow";

  const spansQuery = useTrace(traceId || null);
  const spans = useMemo(() => spansQuery.data ?? [], [spansQuery.data]);

  const [openMinor, setOpenMinor] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Rows, scales, hotspots and totals all come from one pure model, so the
  // waterfall here and a hand-built one see exactly the same numbers.
  const model = useMemo(() => traceModel(spans, { mode: view, openMinor }), [spans, view, openMinor]);
  const { root, total, maxSelf, rows, totals, failed, spots, byId, childrenById } = model;

  // Open on the run's worst moment rather than a collapsed root.
  useEffect(() => {
    if (spans.length === 0) return;
    setSelectedId((cur) => cur ?? defaultSelection(model));
  }, [spans.length, model]);

  const select = useCallback((id: string) => setSelectedId(id), []);

  const container = usePortalContainer();

  // j/k walk the visible rows; e/s/c jump to the derived hotspots. Bound to the
  // document so no row needs focus, but ignored while the reader is somewhere
  // else on the host page — an embedded dashboard has no business swallowing
  // keystrokes aimed at the app around it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.matches("input, textarea, select")) return;
      const root = container?.current;
      const active = document.activeElement;
      const engaged = !root || active === null || active === document.body || root.contains(active);
      if (!engaged) return;
      const next = keyboardTarget(model, selectedId, e.key);
      if (next === null) return;
      select(next);
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [model, selectedId, select, container]);

  const selected = (selectedId ? byId.get(selectedId) : null) ?? null;
  const selectedKids = selected ? (childrenById.get(selected.id) ?? []) : [];

  if (spansQuery.isLoading) {
    return <TraceSkeleton />;
  }
  if (!root) {
    return <div className="flex-1 p-8 text-faint">Trace not found.</div>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-[12.5px] text-faint">
        <RouteLink to={{ page: "sessions", env: route.env }} className="text-muted hover:text-fg">
          Sessions
        </RouteLink>
        <CaretRight size={10} weight="bold" aria-hidden />
        <RouteLink
          to={sessionKey ? { page: "session", sessionKey, env: route.env } : { page: "sessions", env: route.env }}
          className="max-w-[220px] truncate text-muted hover:text-fg"
        >
          {sessionKey ?? "session"}
        </RouteLink>
        <CaretRight size={10} weight="bold" aria-hidden />
        <span className="truncate font-medium text-fg">{displayName(root)}</span>
      </div>

      <VerdictRail
        root={root}
        failed={failed}
        spanCount={spans.length}
        totals={totals}
        spots={spots}
        byId={byId}
        childrenById={childrenById}
        total={total}
        onJump={select}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col border-line lg:border-r">
          <div className="sticky top-0 z-10 grid grid-cols-[250px_1fr] items-end gap-2.5 border-b border-line bg-plate px-3 pt-2 pb-1.5">
            <ToggleGroup
              ariaLabel="Span detail"
              value={view}
              options={VIEWS}
              onChange={(v) => go({ ...route, view: v === "full" ? "full" : undefined }, { replace: true })}
            />
            <Axis total={total} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1.5 pb-4">
            <Tooltip.Provider delay={250}>
              {rows.map((item) =>
                item.type === "span" ? (
                  <SpanRow
                    key={item.span.id}
                    span={item.span}
                    depth={item.depth}
                    kids={item.children}
                    root={root}
                    total={total}
                    maxSelf={maxSelf}
                    selected={selectedId === item.span.id}
                    onSelect={select}
                  />
                ) : (
                  <MinorRow
                    key={`minor:${item.parentId}`}
                    row={item}
                    open={item.open}
                    onToggle={() =>
                      setOpenMinor((cur) => {
                        const next = new Set(cur);
                        if (next.has(item.parentId)) next.delete(item.parentId);
                        else next.add(item.parentId);
                        return next;
                      })
                    }
                  />
                )
              )}
            </Tooltip.Provider>
          </div>

          <Legend />
        </div>

        <div className="min-h-0 min-w-0 overflow-y-auto bg-plate">
          {selected ? (
            <SpanInspector span={selected} kids={selectedKids} total={total} maxSelf={maxSelf} />
          ) : (
            <div className="p-4 text-faint">Select a step to inspect it.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function VerdictRail({
  root,
  failed,
  spanCount,
  totals,
  spots,
  byId,
  childrenById,
  total,
  onJump,
}: {
  root: SpanRecord;
  failed: boolean;
  spanCount: number;
  totals: TraceTotals;
  spots: Hotspots | null;
  byId: Map<string, SpanRecord>;
  childrenById: Map<string, SpanRecord[]>;
  total: number;
  onJump: (id: string) => void;
}) {
  const kidsOf = (id: string): SpanRecord[] => childrenById.get(id) ?? [];

  const chips: {
    key: string;
    tone: string;
    lead: React.ReactNode;
    label: string;
    id: string;
  }[] = [];
  if (spots?.errorId) {
    const s = byId.get(spots.errorId);
    if (s) {
      chips.push({
        key: "e",
        tone: "text-err",
        lead: <XCircle size={12} weight="fill" />,
        label: `${displayName(s)} failed`,
        id: s.id,
      });
    }
  }
  if (spots?.slowestId) {
    const s = byId.get(spots.slowestId);
    if (s) {
      chips.push({
        key: "s",
        tone: "text-heat-hi",
        lead: fmtMs(selfTime(s, kidsOf(s.id))),
        label: "slowest step",
        id: s.id,
      });
    }
  }
  if (spots?.costliestId) {
    const s = byId.get(spots.costliestId);
    if (s?.cost != null) {
      chips.push({ key: "c", tone: "text-muted", lead: fmtCost(s.cost), label: "costliest step", id: s.id });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line bg-plate px-4 py-3">
      <span className="flex items-center gap-2">
        <span className={`h-[7px] w-[7px] flex-none rounded-full ${failed ? "bg-err" : "bg-bar"}`} />
        <span className="text-[14px] font-semibold">{displayName(root)}</span>
      </span>
      <span className="flex gap-3.5 font-mono text-[11.5px] text-muted tabular-nums">
        <span>
          <b className="font-medium text-fg">{fmtMs(total)}</b> total
        </span>
        <span>
          <b className="font-medium text-fg">{spanCount}</b> {spanCount === 1 ? "span" : "spans"}
        </span>
        {(totals.inputTokens > 0 || totals.outputTokens > 0) && (
          <span>
            <b className="font-medium text-fg">
              {fmtTokens(totals.inputTokens, totals.outputTokens)}
            </b>{" "}
            tok
          </span>
        )}
        {totals.cost != null && <b className="font-medium text-fg">{fmtCost(totals.cost)}</b>}
      </span>

      <div className="ml-auto flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => onJump(c.id)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel py-1 pr-2.5 pl-2 text-[11.5px] whitespace-nowrap text-muted hover:border-line-strong hover:text-fg"
          >
            <span className={`flex items-center font-mono text-[11px] ${c.tone}`}>{c.lead}</span>
            {c.label}
            <span className="rounded-[3px] border border-line px-1 font-mono text-[9.5px] text-faint">
              {c.key}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Widths taper with depth so the placeholder reads as a tree, and the bars step
// across the axis the way a real waterfall does.
const SKELETON_ROWS = [
  { indent: 0, name: 108, left: 0, width: 100 },
  { indent: 1, name: 86, left: 2, width: 34 },
  { indent: 1, name: 124, left: 36, width: 41 },
  { indent: 2, name: 92, left: 38, width: 22 },
  { indent: 2, name: 74, left: 61, width: 15 },
  { indent: 1, name: 116, left: 78, width: 19 },
  { indent: 2, name: 68, left: 80, width: 11 },
];

function TraceSkeleton() {
  return (
    <Loading label="Loading trace" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <Skeleton w={54} h={11} />
        <CaretRight size={10} weight="bold" className="text-faint" aria-hidden />
        <Skeleton w={92} h={11} />
        <CaretRight size={10} weight="bold" className="text-faint" aria-hidden />
        <Skeleton w={76} h={11} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line bg-plate px-4 py-3">
        <Skeleton w={7} h={7} className="rounded-full" />
        <Skeleton w={132} h={15} />
        <Skeleton w={168} h={11} />
        <span className="ml-auto flex gap-1.5">
          <Skeleton w={112} h={22} className="rounded-md" />
          <Skeleton w={98} h={22} className="rounded-md" />
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
        <div className="border-line px-3 pt-2 lg:border-r">
          <div className="grid grid-cols-[250px_1fr] items-end gap-2.5 border-b border-line pb-1.5">
            <Skeleton w={122} h={20} className="rounded-md" />
            <Skeleton w="100%" h={9} />
          </div>
          <div className="pt-2.5">
            {SKELETON_ROWS.map((r, i) => (
              <div key={i} className="grid grid-cols-[250px_1fr] items-center gap-2.5 px-1.5 py-1">
                <span className="flex items-center gap-1.5" style={{ paddingLeft: r.indent * 15 }}>
                  <Skeleton w={26} h={11} />
                  <Skeleton w={r.name} h={12} />
                </span>
                <span className="relative h-[15px]">
                  <span
                    className="absolute top-[3px]"
                    style={{ left: `${r.left}%`, width: `${r.width}%` }}
                  >
                    <Skeleton h={9} className="rounded-[2px]" />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-plate px-4 pt-3.5">
          <Skeleton w={148} h={14} />
          <Skeleton w={214} h={11} className="mt-2" />
          <Skeleton w="100%" h={38} className="mt-3.5 rounded-md" />
          <div className="mt-4 grid gap-2">
            {["92%", "100%", "78%", "96%", "64%"].map((w, i) => (
              <Skeleton key={i} w={w} h={12} />
            ))}
          </div>
        </div>
      </div>
    </Loading>
  );
}

const TICK_COUNT = 4;

function Axis({ total }: { total: number }) {
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => (total / TICK_COUNT) * i);
  return (
    <div className="relative h-[15px]">
      {ticks.map((t, i) => (
        <span
          key={i}
          className={`absolute top-0 font-mono text-[9.5px] text-faint tabular-nums ${
            i === 0 ? "pl-px" : "-translate-x-full pr-1"
          }`}
          style={{ left: `${(t / total) * 100}%` }}
        >
          {fmtMs(Math.round(t))}
        </span>
      ))}
    </div>
  );
}

/** Bar fill encodes where the run's time went; red is reserved for failure. */
const HEAT_FILL: Record<HeatLevel, string> = {
  error: "bg-err",
  high: "bg-heat-hi",
  medium: "bg-heat-mid",
  base: "bg-bar",
};

export const heatFill = (
  span: SpanRecord,
  self: number,
  total: number,
  maxSelf: number
): string => HEAT_FILL[heatLevel(span, self, total, maxSelf)];

function SpanRow({
  span,
  depth,
  kids,
  root,
  total,
  maxSelf,
  selected,
  onSelect,
}: {
  span: SpanRecord;
  depth: number;
  kids: SpanRecord[];
  root: SpanRecord;
  total: number;
  maxSelf: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const container = usePortalContainer();
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const ms = extent(span);
  const self = selfTime(span, kids);
  const left = ((span.startTime - root.startTime) / total) * 100;
  const width = Math.max((ms / total) * 100, 0.4);
  const heat = heatFill(span, self, total, maxSelf);
  const gaps = selfIntervals(span, kids);

  const metaOnLeft = left + width > 70;
  const meta = `${fmtMs(ms)}${span.model ? ` · ${span.model}` : ""}`;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            ref={ref}
            onClick={() => onSelect(span.id)}
            aria-selected={selected}
            className={`grid w-full grid-cols-[250px_1fr] items-center gap-2.5 rounded-[5px] px-1.5 py-[3px] ${
              selected ? "bg-sel" : "hover:bg-hover"
            }`}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 15 }}>
          <span
            className={`flex-none rounded-[3px] border border-line bg-panel px-1 py-px font-mono text-[9px] tracking-wide uppercase ${
              span.kind === "llm" || span.kind === "agent"
                ? "border-line-strong text-fg"
                : "text-faint"
            }`}
          >
            {span.kind}
          </span>
          <span
            className={`truncate text-[12.5px] ${span.status === "error" ? "text-err" : ""} ${
              span.kind === "agent" ? "font-semibold" : ""
            }`}
          >
            {displayName(span)}
          </span>
          {span.status === "error" && (
            <XCircle size={12} weight="fill" className="flex-none text-err" aria-label="failed" />
          )}
        </span>

        <span className="relative h-[15px]">
          {Array.from({ length: TICK_COUNT - 1 }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute -top-[3px] -bottom-[3px] w-px bg-line"
              style={{ left: `${((i + 1) / TICK_COUNT) * 100}%` }}
            />
          ))}
          <span
            className="absolute top-[3px] h-[9px] min-w-[2px] rounded-[2px] border border-line-strong"
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            {gaps.map(([a, b], i) => (
              <span
                key={i}
                className={`absolute top-0 bottom-0 min-w-[1.5px] rounded-[1px] ${heat}`}
                style={{
                  left: `${((a - span.startTime) / (ms || 1)) * 100}%`,
                  width: `${((b - a) / (ms || 1)) * 100}%`,
                }}
              />
            ))}
          </span>
          <span
            className="absolute top-px font-mono text-[10px] whitespace-nowrap text-faint tabular-nums"
            style={
              metaOnLeft
                ? { right: `${100 - left}%`, paddingRight: 7 }
                : { left: `${left + width}%`, paddingLeft: 7 }
            }
          >
            {meta}
          </span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal container={container}>
        <Tooltip.Positioner side="top" align="center" sideOffset={6}>
          <Tooltip.Popup className="rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[11px] text-muted shadow-lg tabular-nums">
            <div className="text-fg">{displayName(span)}</div>
            <div>
              starts +{fmtMs(span.startTime - root.startTime)} · {fmtMs(ms)} total
            </div>
            <div>
              {fmtMs(self)} self ({Math.round((self / total) * 100)}% of run)
            </div>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function MinorRow({
  row,
  open,
  onToggle,
}: {
  row: Extract<TraceRow, { type: "minor" }>;
  open: boolean;
  onToggle: () => void;
}) {
  const names = row.spans.map(displayName).join(", ");
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-1.5 rounded-[5px] px-1.5 py-[3px] text-[11.5px] text-faint hover:bg-hover hover:text-muted"
      style={{ paddingLeft: row.depth * 15 + 6 }}
    >
      {open ? <CaretDown size={9} weight="bold" /> : <CaretRight size={9} weight="bold" />}
      {row.spans.length} {row.spans.length === 1 ? "minor step" : "minor steps"} · {names}
    </button>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
      <span className="flex items-center gap-1.5">
        <span className="h-[9px] w-[22px] rounded-[2px] border border-line-strong" /> total extent
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-[9px] w-[22px] rounded-[2px] bg-bar" /> self time
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-[9px] w-[22px] rounded-[2px] bg-heat-hi" /> time hotspot
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Key>j</Key>
        <Key>k</Key> move
        <Key>e</Key> error
        <Key>s</Key> slowest
      </span>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return (
    <span className="rounded-[3px] border border-line px-1 font-mono text-[10px] text-faint">
      {children}
    </span>
  );
}
