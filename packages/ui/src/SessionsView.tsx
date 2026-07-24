import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fmtCost, fmtMs, fmtTokens, fmtTime } from "./api.js";
import type { RunSummary, SessionSummary } from "./types.js";
import { preview } from "@breadcrumb-sh/core/kit";
import { TraceExplorer } from "./TraceExplorer.js";

export function SessionsView({ environment }: { environment?: string }) {
  const navigate = useNavigate();
  const sessions = useQuery({
    queryKey: ["sessions", environment],
    queryFn: () => api.sessions(environment),
  });

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-8 pt-6 pb-16">
      <div className="mx-auto max-w-[820px]">
        <h1 className="mb-4 text-[15px] font-semibold">Sessions</h1>
        {sessions.isLoading && <div className="text-faint">loading…</div>}
        {sessions.data?.length === 0 && (
          <div className="rounded-md bg-panel/50 px-4 py-10 text-center text-faint">
            No traces yet. Send some and they'll show up here.
          </div>
        )}
        <div className="grid gap-px">
          {sessions.data?.map((s) => (
            <SessionRow
              key={s.sessionKey}
              session={s}
              onOpen={() => navigate(`/sessions/${encodeURIComponent(s.sessionKey)}`)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionRow({ session: s, onOpen }: { session: SessionSummary; onOpen: () => void }) {
  const failed = s.errorCount > 0;
  return (
    <button
      onClick={onOpen}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 rounded-md px-3.5 py-2.5 hover:bg-panel/60"
    >
      <span className="flex min-w-0 items-baseline gap-3">
        <span className="truncate font-medium">
          {s.userId ?? s.sessionId ?? s.sessionKey.slice(0, 8)}
        </span>
        {failed && (
          <span className="truncate font-mono text-[11.5px] text-err">✗ {s.failName ?? "error"}</span>
        )}
      </span>
      <span className="flex items-baseline gap-4 font-mono text-[11.5px] whitespace-nowrap text-faint tabular-nums">
        <span className="w-14 text-right">{s.runCount === 1 ? "1 run" : `${s.runCount} runs`}</span>
        <span className="w-16 text-right">{s.cost != null ? fmtCost(s.cost) : "–"}</span>
        <span className="w-18 text-right">{fmtTime(s.endTime ?? s.startTime)}</span>
      </span>
    </button>
  );
}

export function SessionDetail() {
  const { sessionKey = "" } = useParams();
  const [openRun, setOpenRun] = useState<{ traceId: string; failed: boolean } | null>(null);

  const sessions = useQuery({ queryKey: ["sessions", undefined], queryFn: () => api.sessions() });
  const session = sessions.data?.find((s) => s.sessionKey === sessionKey);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenRun(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <RunFeed
        sessionKey={sessionKey}
        session={session}
        openRun={openRun?.traceId ?? null}
        onToggleRun={(r) =>
          setOpenRun((cur) =>
            cur?.traceId === r.traceId ? null : { traceId: r.traceId, failed: r.errorCount > 0 }
          )
        }
      />
      <TraceExplorer
        traceId={openRun?.traceId ?? null}
        jumpToError={openRun?.failed ?? false}
        onClose={() => setOpenRun(null)}
      />
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
    <div className="min-w-0 flex-1 overflow-y-auto px-8 pt-6 pb-16">
      <div className="mx-auto max-w-[680px]">
        <div className="mb-5 flex items-baseline gap-3 text-[13px] text-faint">
          <Link to="/" className="text-faint hover:text-muted">
            Sessions
          </Link>
          <span>/</span>
          <b className="text-[15px] font-semibold text-fg">
            {session?.userId ?? session?.sessionId ?? sessionKey.slice(0, 8)}
          </b>
          <span className="flex-1" />
          {session && (
            <span className="font-mono text-xs">
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
    <div className="my-3 overflow-hidden rounded-md bg-panel">
      <div className="flex items-baseline gap-2.5 px-4 pt-3">
        <h3 className="font-semibold">{run.name}</h3>
        <span className="ml-auto font-mono text-[11px] text-faint">{fmtTime(run.startTime)}</span>
      </div>
      <div className="grid gap-1 px-4 pt-1.5 pb-2 text-[13px]">
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
        className={`mx-2.5 mb-2 inline-flex items-center gap-3.5 rounded px-1.5 py-1 font-mono text-[11.5px] tabular-nums ${
          open ? "bg-panel2 text-fg" : "text-faint hover:text-muted"
        }`}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{run.spanCount} steps</span>
        <span>{fmtMs(run.endTime != null ? run.endTime - run.startTime : null)}</span>
        <span>{fmtTokens(run.inputTokens, run.outputTokens)} tok</span>
        {failed ? <span className="text-err">✗ {run.failName}</span> : <span>{fmtCost(run.cost)}</span>}
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
