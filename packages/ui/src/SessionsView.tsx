import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtCost, fmtMs, fmtTokens, fmtTime } from "./api.js";
import type { RunSummary, SessionSummary } from "./types.js";
import { preview } from "./tree.js";
import { TraceExplorer } from "./TraceExplorer.js";

export function SessionsView({ environment }: { environment?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<{ traceId: string; failed: boolean } | null>(null);

  const sessions = useQuery({
    queryKey: ["sessions", environment],
    queryFn: () => api.sessions(environment),
  });

  const active = selected ?? sessions.data?.[0]?.sessionKey ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenRun(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="flex min-h-0 flex-1">
      <SessionRail
        sessions={sessions.data ?? []}
        loading={sessions.isLoading}
        active={active}
        onSelect={(key) => {
          setSelected(key);
          setOpenRun(null);
        }}
      />
      {active ? (
        <RunFeed
          sessionKey={active}
          session={sessions.data?.find((s) => s.sessionKey === active)}
          openRun={openRun?.traceId ?? null}
          onToggleRun={(r) =>
            setOpenRun((cur) =>
              cur?.traceId === r.traceId ? null : { traceId: r.traceId, failed: r.errorCount > 0 }
            )
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-faint">
          {sessions.isLoading ? "loading…" : "No traces yet. Send some and they'll show up here."}
        </div>
      )}
      <TraceExplorer
        traceId={openRun?.traceId ?? null}
        jumpToError={openRun?.failed ?? false}
        onClose={() => setOpenRun(null)}
      />
    </main>
  );
}

function SessionRail({
  sessions,
  loading,
  active,
  onSelect,
}: {
  sessions: SessionSummary[];
  loading: boolean;
  active: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="w-[280px] flex-none overflow-y-auto border-r border-line">
      <div className="px-3.5 pt-3 pb-1.5 font-mono text-[11px] tracking-wider text-faint uppercase">
        sessions
      </div>
      {loading && <div className="px-3.5 py-2 text-faint">loading…</div>}
      {sessions.map((s) => (
        <button
          key={s.sessionKey}
          onClick={() => onSelect(s.sessionKey)}
          aria-selected={s.sessionKey === active}
          className={`block w-full border-b border-panel px-3.5 py-2.5 hover:bg-panel ${
            s.sessionKey === active ? "bg-panel2 shadow-[inset_2px_0_0_var(--color-accent)]" : ""
          }`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">
              {s.userId ?? s.sessionId ?? s.sessionKey.slice(0, 8)}
            </span>
            <span className="flex-none font-mono text-[11px] text-faint">{fmtTime(s.endTime ?? s.startTime)}</span>
          </div>
          <div className="mt-0.5 flex gap-3 font-mono text-[11.5px] text-muted tabular-nums">
            <span>{s.runCount === 1 ? "1 run" : `${s.runCount} runs`}</span>
            {s.errorCount > 0 && <span className="text-err">✗ {s.failName ?? "error"}</span>}
            {s.cost != null && <span className="text-accent">{fmtCost(s.cost)}</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

function RunFeed({
  sessionKey,
  session,
  openRun,
  onToggleRun,
}: {
  sessionKey: string;
  session: SessionSummary | undefined;
  openRun: string | null;
  onToggleRun: (r: RunSummary) => void;
}) {
  const runs = useQuery({
    queryKey: ["runs", sessionKey],
    queryFn: () => api.runs(sessionKey),
  });

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-7 pt-6 pb-16">
      <div className="mx-auto max-w-[680px]">
        <div className="mb-5 flex items-baseline gap-4 text-[13px] text-muted">
          <b className="text-[15px] font-semibold text-fg">
            {session?.userId ?? session?.sessionId ?? sessionKey.slice(0, 8)}
          </b>
          <span>{session?.sessionId ? `session ${session.sessionId}` : "single run"}</span>
          <span className="flex-1" />
          {session && (
            <span className="font-mono text-xs text-accent">
              {fmtTokens(session.inputTokens, session.outputTokens)} tok
              {session.cost != null ? ` · ${fmtCost(session.cost)}` : ""}
            </span>
          )}
        </div>

        {runs.data?.map((r) => (
          <RunCard key={r.traceId} run={r} open={openRun === r.traceId} onToggle={() => onToggleRun(r)} />
        ))}
        {runs.isLoading && <div className="text-faint">loading…</div>}
      </div>
    </div>
  );
}

function RunCard({ run, open, onToggle }: { run: RunSummary; open: boolean; onToggle: () => void }) {
  const failed = run.errorCount > 0;
  return (
    <div className={`my-3 overflow-hidden rounded-[10px] border bg-panel ${failed ? "border-err/40" : "border-line"}`}>
      <div className="flex items-baseline gap-2.5 px-3.5 pt-2.5">
        <h3 className="font-semibold">{run.name}</h3>
        <span className="ml-auto font-mono text-[11px] text-faint">{fmtTime(run.startTime)}</span>
      </div>
      <div className="grid gap-1 px-3.5 pt-1.5 pb-2 text-[13px]">
        <div className="truncate text-muted">
          <PayloadLabel>in</PayloadLabel>
          {preview(run.input)}
        </div>
        <div className={failed ? "text-err" : "text-fg"}>
          <PayloadLabel>out</PayloadLabel>
          {failed ? `✗ ${run.failName}: ${run.failError ?? "error"}` : preview(run.output, 400)}
        </div>
      </div>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={`mx-2 mb-2 inline-flex items-center gap-3.5 rounded-md px-2 py-1 font-mono text-[11.5px] tabular-nums ${
          open ? "bg-panel2 text-fg" : "text-faint hover:bg-panel2 hover:text-muted"
        }`}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{run.spanCount} steps</span>
        <span>{fmtMs(run.endTime != null ? run.endTime - run.startTime : null)}</span>
        <span>{fmtTokens(run.inputTokens, run.outputTokens)} tok</span>
        {failed ? (
          <span className="text-err">✗ {run.failName}</span>
        ) : (
          <span className="text-accent">{fmtCost(run.cost)}</span>
        )}
      </button>
    </div>
  );
}

function PayloadLabel({ children }: { children: string }) {
  return (
    <b className="mr-2 font-mono text-[10.5px] font-medium tracking-wider text-faint uppercase">
      {children}
    </b>
  );
}
