"use client";
import { useMemo, useState } from "react";
import { ArrowRight, CaretRight, MagnifyingGlass, XCircle } from "@phosphor-icons/react";
import type { RunSummary, SessionSummary } from "@breadcrumb-sh/core/client";
import { fmtCost, fmtMs, fmtTime, fmtTokens, preview } from "@breadcrumb-sh/core/kit";
import { useRuns, useSessions } from "../hooks.js";
import { RouteLink, useNavigation } from "./navigation.js";
import { Select } from "./ui/Select.js";
import { EnvFilter, useEnvironment } from "./ui/EnvFilter.js";
import { Loading, Skeleton } from "./ui/Skeleton.js";

type StatusFilter = "all" | "error";

const GRID = "grid-cols-[minmax(0,1fr)_78px_66px_66px]";

export function SessionsView() {
  const { go } = useNavigation();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const { env, value: envValue, setEnv, environments } = useEnvironment();

  const sessions = useSessions({ environment: env });
  const all = sessions.data?.items;

  const rows = useMemo(() => {
    let items = all ?? [];
    if (status === "error") items = items.filter((s) => s.errorCount > 0);
    const q = query.trim().toLowerCase();
    if (q) {
      items = items.filter((s) =>
        [s.userId, s.sessionId, s.sessionKey, s.failName]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return items;
  }, [all, status, query]);

  const failing = (all ?? []).filter((s) => s.errorCount > 0).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <label className="relative flex min-w-[180px] flex-1 items-center">
          <MagnifyingGlass
            size={13}
            className="pointer-events-none absolute left-2.5 text-faint"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions, users, errors"
            aria-label="Search sessions"
            className="w-full rounded-md border border-line bg-panel py-1.5 pr-2.5 pl-7 text-[12.5px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
        </label>
        <Select
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          items={[
            { value: "all", label: "All sessions" },
            { value: "error", label: `Failed only${failing ? ` (${failing})` : ""}` },
          ]}
        />
        <EnvFilter value={envValue} onChange={setEnv} environments={environments} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-6">
        <div className="max-w-[1000px]">
          {sessions.isLoading && <SessionsSkeleton />}

          {all?.length === 0 && <Empty>No traces yet. Send some and they'll show up here.</Empty>}

          {all && all.length > 0 && rows.length === 0 && (
            <Empty>No sessions match this filter.</Empty>
          )}

          {rows.length > 0 && (
            <>
              <div
                className={`mb-1 grid ${GRID} items-center gap-3.5 border-b border-line px-2 pt-2 pb-1.5 font-mono text-[9.5px] tracking-[0.12em] text-faint uppercase`}
              >
                <span>Session</span>
                <span className="text-right">Runs</span>
                <span className="text-right">Cost</span>
                <span className="text-right">Last seen</span>
              </div>
              {rows.map((s) => (
                <SessionRow
                  key={s.sessionKey}
                  session={s}
                  onOpen={() => go({ page: "session", sessionKey: s.sessionKey, env })}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-md border border-line bg-panel px-4 py-10 text-center text-faint">
      {children}
    </div>
  );
}

// Fixed widths — a skeleton that shuffles on every render reads as broken.
const NAME_WIDTHS = [172, 128, 205, 149, 116, 188, 141, 162];

function SessionsSkeleton() {
  return (
    <Loading label="Loading sessions">
      <div
        className={`mb-1 grid ${GRID} items-center gap-3.5 border-b border-line px-2 pt-2 pb-1.5`}
      >
        <Skeleton w={52} h={8} />
        <Skeleton w={28} h={8} className="ml-auto" />
        <Skeleton w={28} h={8} className="ml-auto" />
        <Skeleton w={44} h={8} className="ml-auto" />
      </div>
      {NAME_WIDTHS.map((w, i) => (
        <div key={i} className={`grid ${GRID} items-center gap-3.5 px-2 py-2`}>
          <span className="flex items-center gap-2.5">
            <Skeleton w={7} h={7} className="rounded-full" />
            <Skeleton w={w} h={12} />
          </span>
          <Skeleton w={24} h={11} className="ml-auto" />
          <Skeleton w={40} h={11} className="ml-auto" />
          <Skeleton w={48} h={11} className="ml-auto" />
        </div>
      ))}
    </Loading>
  );
}

function SessionRow({ session: s, onOpen }: { session: SessionSummary; onOpen: () => void }) {
  const failed = s.errorCount > 0;
  return (
    <button
      onClick={onOpen}
      className={`grid w-full ${GRID} items-center gap-3.5 rounded-md px-2 py-2 hover:bg-hover`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`h-[7px] w-[7px] flex-none rounded-full ${failed ? "bg-err" : "bg-bar"}`} />
        <span className="truncate text-[12.5px] font-medium">
          {s.userId ?? s.sessionId ?? s.sessionKey.slice(0, 8)}
        </span>
        {failed && (
          <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-err">
            <XCircle size={12} weight="fill" className="flex-none" />
            <span className="truncate">{s.failName ?? "error"}</span>
          </span>
        )}
      </span>
      <span className="text-right font-mono text-[11.5px] text-muted tabular-nums">
        {s.runCount}
        {failed && <span className="text-err"> · {s.errorCount}✗</span>}
      </span>
      <span className="text-right font-mono text-[11.5px] text-fg tabular-nums">
        {s.cost != null ? fmtCost(s.cost) : "–"}
      </span>
      <span className="text-right font-mono text-[11.5px] text-muted tabular-nums">
        {fmtTime(s.endTime ?? s.startTime)}
      </span>
    </button>
  );
}

export function SessionDetail() {
  const { route, go } = useNavigation();
  const sessionKey = route.sessionKey ?? "";

  const sessions = useSessions();
  const session = sessions.data?.items.find((s) => s.sessionKey === sessionKey);
  const runs = useRuns(sessionKey);

  const slowest = useMemo(() => {
    let best = 0;
    for (const r of runs.data ?? []) {
      if (r.endTime != null) best = Math.max(best, r.endTime - r.startTime);
    }
    return best || null;
  }, [runs.data]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-[12.5px] text-faint">
        <RouteLink to={{ page: "sessions", env: route.env }} className="text-muted hover:text-fg">
          Sessions
        </RouteLink>
        <CaretRight size={10} weight="bold" aria-hidden />
        <span className="truncate font-medium text-fg">
          {session?.userId ?? session?.sessionId ?? sessionKey.slice(0, 8)}
        </span>
        <span className="flex-1" />
        {session && (
          <span className="font-mono text-[11.5px] text-muted tabular-nums">
            {fmtTokens(session.inputTokens, session.outputTokens)} tok
            {session.cost != null ? ` · ${fmtCost(session.cost)}` : ""}
            {slowest != null ? ` · ${fmtMs(slowest)} slowest` : ""}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10">
        <div className="max-w-[760px]">
          {runs.isLoading && <RunsSkeleton />}
          {runs.data?.map((r) => (
            <RunCard
              key={r.traceId}
              run={r}
              onOpen={() =>
                go({ page: "trace", sessionKey, traceId: r.traceId, env: route.env })
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RunsSkeleton() {
  return (
    <Loading label="Loading runs">
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-2.5 overflow-hidden rounded-md border border-line bg-panel">
          <div className="flex items-center gap-2.5 px-3.5 pt-3">
            <Skeleton w={7} h={7} className="rounded-full" />
            <Skeleton w={i === 1 ? 118 : 154} h={13} />
            <Skeleton w={46} h={10} className="ml-auto" />
          </div>
          <div className="grid gap-2 px-3.5 pt-3 pb-3">
            <Skeleton w="72%" h={12} />
            <Skeleton w={i === 2 ? "54%" : "88%"} h={12} />
          </div>
          <div className="flex gap-3.5 border-t border-line px-3.5 py-2">
            {[46, 38, 62, 44].map((w, j) => (
              <Skeleton key={j} w={w} h={10} />
            ))}
          </div>
        </div>
      ))}
    </Loading>
  );
}

function RunCard({ run, onOpen }: { run: RunSummary; onOpen: () => void }) {
  const failed = run.errorCount > 0;
  const ms = run.endTime != null ? run.endTime - run.startTime : null;
  return (
    <button
      onClick={onOpen}
      className="mb-2.5 block w-full overflow-hidden rounded-md border border-line bg-panel text-left hover:border-line-strong"
    >
      <div className="flex items-baseline gap-2.5 px-3.5 pt-2.5">
        <span className={`h-[7px] w-[7px] flex-none rounded-full ${failed ? "bg-err" : "bg-bar"}`} />
        <h3 className="text-[13px] font-semibold">{run.name}</h3>
        <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">
          {fmtTime(run.startTime)}
        </span>
      </div>

      <div className="grid gap-1 px-3.5 pt-1.5 pb-2 text-[12.5px]">
        <div className="truncate text-muted">
          <Label>in</Label>
          {preview(run.input)}
        </div>
        <div className={failed ? "text-err" : ""}>
          <Label>out</Label>
          {failed ? `✗ ${run.failName}: ${run.failError ?? "error"}` : preview(run.output, 400)}
        </div>
      </div>

      <div className="flex items-center gap-3.5 border-t border-line px-3.5 py-1.5 font-mono text-[11px] text-faint tabular-nums">
        <span>{run.spanCount} steps</span>
        <span>{fmtMs(ms)}</span>
        <span>{fmtTokens(run.inputTokens, run.outputTokens)} tok</span>
        <span>{fmtCost(run.cost)}</span>
        <span className="ml-auto flex items-center gap-1 text-muted">
          open trace <ArrowRight size={11} weight="bold" />
        </span>
      </div>
    </button>
  );
}

function Label({ children }: { children: string }) {
  return (
    <b className="mr-2 font-mono text-[10.5px] font-medium tracking-wider text-faint uppercase">
      {children}
    </b>
  );
}
