import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pulse, CheckCircle, XCircle } from "@phosphor-icons/react";
import { trpc } from "../../../../lib/trpc";
import { TraceSheet } from "../../../../components/TraceSheet";
import { DateRangePopover, today, presetFrom } from "../../../../components/DateRangePopover";
import { MultiselectCombobox } from "../../../../components/MultiselectCombobox";

export const Route = createFileRoute("/_authed/projects/$projectId/traces")({
  component: TracesPage,
});

type SelectedTrace = { id: string; name: string };

function TracesPage() {
  const { projectId } = Route.useParams();

  // Date range
  const [from, setFrom]     = useState(() => presetFrom(30));
  const [to, setTo]         = useState(today);
  const [preset, setPreset] = useState<7 | 30 | 90 | null>(30);

  // Filters
  const [selectedNames,    setSelectedNames]    = useState<string[]>([]);
  const [selectedModels,   setSelectedModels]   = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [envFilter,        setEnvFilter]        = useState("");

  const [selected, setSelected] = useState<SelectedTrace | null>(null);

  const applyPreset    = (days: 7 | 30 | 90) => { setFrom(presetFrom(days)); setTo(today()); setPreset(days); };
  const handleFromChange = (v: string) => { setFrom(v); setPreset(null); };
  const handleToChange   = (v: string) => { setTo(v);   setPreset(null); };

  const traces   = trpc.traces.list.useQuery({
    projectId,
    from,
    to,
    names:       selectedNames.length    > 0 ? selectedNames    : undefined,
    models:      selectedModels.length   > 0 ? selectedModels   : undefined,
    statuses:    selectedStatuses.length > 0 ? selectedStatuses as ("ok" | "error")[] : undefined,
    environment: envFilter || undefined,
  });
  const envList    = trpc.traces.environments.useQuery({ projectId });
  const modelList  = trpc.traces.models.useQuery({ projectId });
  const nameList   = trpc.traces.names.useQuery({ projectId });

  const hasFilters = selectedNames.length > 0 || selectedModels.length > 0 ||
                     selectedStatuses.length > 0 || !!envFilter;

  return (
    <>
    <main className="px-4 py-5 sm:px-6 space-y-4">

      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">

        <DateRangePopover
          from={from}
          to={to}
          preset={preset}
          onPreset={applyPreset}
          onCustom={() => setPreset(null)}
          onFromChange={handleFromChange}
          onToChange={handleToChange}
        />

        <div className="h-4 w-px bg-zinc-800" />

        <MultiselectCombobox
          options={nameList.data ?? []}
          selected={selectedNames}
          onChange={setSelectedNames}
          placeholder="All traces"
        />

        <MultiselectCombobox
          options={modelList.data ?? []}
          selected={selectedModels}
          onChange={setSelectedModels}
          placeholder="All models"
        />

        <MultiselectCombobox
          options={["ok", "error"]}
          selected={selectedStatuses}
          onChange={setSelectedStatuses}
          placeholder="All statuses"
        />

        {(envList.data?.length ?? 0) > 0 && (
          <select
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value)}
            className="h-[30px] rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-400 outline-none focus:border-zinc-600 cursor-pointer"
          >
            <option value="">All environments</option>
            {envList.data!.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Trace table ───────────────────────────────────────── */}
      {traces.isLoading ? null : !traces.data?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-16 text-center">
          <Pulse size={32} className="text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-400">No traces found</p>
          <p className="mt-1 text-xs text-zinc-500">
            {hasFilters
              ? "Try adjusting your filters."
              : "Send your first trace using the SDK to see it here."}
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
