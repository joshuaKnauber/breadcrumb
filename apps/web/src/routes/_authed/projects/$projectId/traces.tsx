import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pulse, CheckCircle, XCircle } from "@phosphor-icons/react";
import { trpc } from "../../../../lib/trpc";
import { TraceSheet } from "../../../../components/TraceSheet";

export const Route = createFileRoute("/_authed/projects/$projectId/traces")({
  component: TracesPage,
});

type SelectedTrace = { id: string; name: string };

function TracesPage() {
  const { projectId } = Route.useParams();
  const stats  = trpc.traces.stats.useQuery({ projectId });
  const traces = trpc.traces.list.useQuery({ projectId });
  const [selected, setSelected] = useState<SelectedTrace | null>(null);

  return (
    <>
    <main className="p-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total traces"
          value={stats.data ? String(stats.data.traceCount) : "—"}
          loading={stats.isLoading}
        />
        <StatCard
          label="Total cost"
          value={stats.data ? formatCost(stats.data.totalCostUsd) : "—"}
          loading={stats.isLoading}
        />
      </div>

      {/* Trace table */}
      {traces.isLoading ? null : !traces.data?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-16 text-center">
          <Pulse size={32} className="text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-400">No traces yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            Send your first trace using the SDK to see it here.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Spans</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Tokens</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Cost</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Duration</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {traces.data.map((trace) => (
                <tr
                  key={trace.id}
                  className="hover:bg-zinc-900/50 transition-colors cursor-pointer"
                  onClick={() => setSelected({ id: trace.id, name: trace.name })}
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-zinc-100">{trace.name}</span>
                    {trace.userId && (
                      <span className="ml-2 text-xs text-zinc-500">{trace.userId}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={trace.status} />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{trace.spanCount}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {trace.inputTokens + trace.outputTokens > 0
                      ? formatTokens(trace.inputTokens + trace.outputTokens)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {trace.costUsd > 0 ? formatCost(trace.costUsd) : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {formatDuration(trace.startTime, trace.endTime)}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {formatTime(trace.startTime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </main>
    <TraceSheet
      projectId={projectId}
      traceId={selected?.id ?? null}
      traceName={selected?.name}
      onClose={() => setSelected(null)}
    />
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4 space-y-1">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-2xl font-semibold tracking-tight ${loading ? "text-zinc-700 animate-pulse" : "text-zinc-100"}`}>
        {loading ? "———" : value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: "ok" | "error" }) {
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400">
        <XCircle size={13} weight="fill" />
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
      <CheckCircle size={13} weight="fill" />
      ok
    </span>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end.replace(" ", "T") + "Z").getTime() -
             new Date(start.replace(" ", "T") + "Z").getTime();
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(chDate: string): string {
  return new Date(chDate.replace(" ", "T") + "Z").toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
