import { useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { CurrencyDollar, Pulse, Timer, XCircle } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "../../../../lib/trpc";
import { useTheme } from "../../../../hooks/useTheme";
import { DateRangePopover, today, presetFrom } from "../../../../components/DateRangePopover";
import { MultiselectCombobox } from "../../../../components/MultiselectCombobox";

export const Route = createFileRoute("/_authed/projects/$projectId/")({
  component: OverviewPage,
});

type Metric = "traces" | "cost" | "errors";

function OverviewPage() {
  const { projectId } = Route.useParams();
  const { theme } = useTheme();

  // Date range
  const [from, setFrom]     = useState(() => presetFrom(30));
  const [to, setTo]         = useState(today);
  const [preset, setPreset] = useState<7 | 30 | 90 | null>(30);

  // Filters
  const [selectedNames,  setSelectedNames]  = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [envFilter, setEnvFilter] = useState("");

  const applyPreset = (days: 7 | 30 | 90) => {
    setFrom(presetFrom(days));
    setTo(today());
    setPreset(days);
  };

  const handleFromChange = (v: string) => { setFrom(v); setPreset(null); };
  const handleToChange   = (v: string) => { setTo(v);   setPreset(null); };

  const commonFilters = {
    projectId,
    from,
    to,
    environment: envFilter || undefined,
    models:      selectedModels.length > 0 ? selectedModels : undefined,
    names:       selectedNames.length  > 0 ? selectedNames  : undefined,
  };

  const stats      = trpc.traces.stats.useQuery(commonFilters);
  const daily      = trpc.traces.dailyMetrics.useQuery(commonFilters);
  const breakdown  = trpc.traces.modelBreakdown.useQuery({ projectId, from, to, models: selectedModels.length > 0 ? selectedModels : undefined });
  const envList    = trpc.traces.environments.useQuery({ projectId });
  const modelList  = trpc.traces.models.useQuery({ projectId });
  const nameList   = trpc.traces.names.useQuery({ projectId });

  const nivoTheme   = buildNivoTheme(theme);
  const rangeDays   = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  const xTickValues = rangeDays <= 7 ? "every day" : rangeDays <= 31 ? "every 7 days" : "every 14 days";
  const totalCost   = stats.data?.totalCostUsd ?? 0;

  return (
    <main className="px-4 py-5 sm:px-8 sm:py-7 space-y-6">

      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">

        {/* Date range */}
        <DateRangePopover
          from={from}
          to={to}
          preset={preset}
          onPreset={applyPreset}
          onCustom={() => setPreset(null)}
          onFromChange={handleFromChange}
          onToChange={handleToChange}
        />

        {/* Divider */}
        <div className="h-4 w-px bg-zinc-800" />

        {/* Trace name multiselect */}
        <MultiselectCombobox
          options={nameList.data ?? []}
          selected={selectedNames}
          onChange={setSelectedNames}
          placeholder="All traces"
        />

        {/* Environment */}
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

        {/* Model */}
        <MultiselectCombobox
          options={modelList.data ?? []}
          selected={selectedModels}
          onChange={setSelectedModels}
          placeholder="All models"
        />
      </div>

      {/* ── Stat cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:flex gap-4">
        <StatCard
          icon={<Pulse size={16} className="text-zinc-400" />}
          label="Traces"
          value={stats.data ? stats.data.traceCount.toLocaleString() : "—"}
          loading={stats.isLoading}
        />
        <StatCard
          icon={<CurrencyDollar size={16} className="text-zinc-400" />}
          label="Total cost"
          value={stats.data ? formatCost(stats.data.totalCostUsd) : "—"}
          loading={stats.isLoading}
        />
        <StatCard
          icon={<Timer size={16} className="text-zinc-400" />}
          label="Avg duration"
          value={stats.data ? formatDuration(stats.data.avgDurationMs) : "—"}
          loading={stats.isLoading}
        />
        <StatCard
          icon={<XCircle size={16} className="text-zinc-400" />}
          label="Error rate"
          value={stats.data ? formatErrorRate(stats.data.errorRate) : "—"}
          loading={stats.isLoading}
        />
      </div>

      {/* ── Charts ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">

      {/* Row 1: Traces + Errors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard
          label="Traces"
          data={buildChartData(daily.data ?? [], from, to, "traces")}
          loading={daily.isLoading}
          nivoTheme={nivoTheme}
          xTickValues={xTickValues}
          formatTooltip={(y) => `${y} traces`}
        />
        <ChartCard
          label="Errors"
          data={buildChartData(daily.data ?? [], from, to, "errors")}
          loading={daily.isLoading}
          nivoTheme={nivoTheme}
          xTickValues={xTickValues}
          formatTooltip={(y) => `${y} errors`}
        />
      </div>

      {/* Row 2: Cost + Model usage */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard
          label="Cost"
          data={buildChartData(daily.data ?? [], from, to, "cost")}
          loading={daily.isLoading}
          nivoTheme={nivoTheme}
          xTickValues={xTickValues}
          leftMargin={52}
          formatAxis={(v) => `$${formatAxisCost(Number(v))}`}
          formatTooltip={(y) => formatCost(Number(y))}
        />

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800">
            <p className="text-xs font-medium text-zinc-500">Model usage</p>
          </div>

          {breakdown.isLoading ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-xs text-zinc-600 animate-pulse">Loading…</span>
            </div>
          ) : (breakdown.data?.length ?? 0) === 0 ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-xs text-zinc-600">No model data</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-5 py-2 border-b border-zinc-800">
                <p className="flex-1 text-xs font-medium text-zinc-500">Model</p>
                <p className="w-16 text-right text-xs font-medium text-zinc-500 shrink-0">Runs</p>
                <p className="w-16 text-right text-xs font-medium text-zinc-500 shrink-0">Cost</p>
                <p className="w-20 text-right text-xs font-medium text-zinc-500 shrink-0">% of cost</p>
              </div>
              <div className="divide-y divide-zinc-800">
                {breakdown.data!.map((row) => {
                  const pct = totalCost > 0 ? Math.round((row.costUsd / totalCost) * 100) : 0;
                  return (
                    <div key={`${row.provider}-${row.model}`} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 uppercase tracking-wide">
                          {row.provider}
                        </span>
                        <span className="text-xs font-medium text-zinc-100 truncate">
                          {row.model}
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500 w-16 text-right shrink-0 tabular-nums">
                        {row.traceCount.toLocaleString()}
                      </span>
                      <span className="text-xs text-zinc-400 w-16 text-right shrink-0 tabular-nums">
                        {formatCost(row.costUsd)}
                      </span>
                      <div className="w-20 shrink-0 flex items-center justify-end gap-2">
                        <div className="w-10 h-1 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="h-full bg-zinc-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-zinc-500 w-6 text-right tabular-nums">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      </div>{/* end charts wrapper */}
    </main>
  );
}

// ── Chart helpers ──────────────────────────────────────────────────────────────

type DailyMetric = { date: string; traces: number; costUsd: number; errors: number };

function buildChartData(rows: DailyMetric[], from: string, to: string, metric: Metric) {
  const map = new Map(
    rows.map((r) => [
      r.date,
      metric === "traces" ? r.traces : metric === "cost" ? r.costUsd : r.errors,
    ])
  );
  const data: { x: string; y: number }[] = [];
  const start = new Date(from);
  const end   = new Date(to);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    data.push({ x: key, y: map.get(key) ?? 0 });
  }
  return data;
}

function buildNivoTheme(theme: "dark" | "light") {
  const isDark = theme === "dark";
  return {
    background: "transparent",
    text: { fill: isDark ? "#7a7570" : "#7a7570", fontSize: 11 },
    axis: {
      ticks: { text: { fill: isDark ? "#7a7570" : "#7a7570" } },
      legend: { text: { fill: isDark ? "#7a7570" : "#7a7570" } },
    },
    grid: { line: { stroke: isDark ? "#242018" : "#e3e0db", strokeWidth: 1 } },
    crosshair: { line: { stroke: isDark ? "#35302a" : "#c8c4be" } },
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChartCard({
  label,
  data,
  loading,
  nivoTheme,
  xTickValues,
  leftMargin = 36,
  formatAxis,
  formatTooltip,
}: {
  label: string;
  data: { x: string; y: number }[];
  loading?: boolean;
  nivoTheme: object;
  xTickValues: string;
  leftMargin?: number;
  formatAxis?: (v: string | number) => string;
  formatTooltip?: (y: string | number) => string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-5 pb-4">
      <p className="text-xs font-medium text-zinc-500 mb-4">{label}</p>
      <div style={{ height: 180 }}>
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-xs text-zinc-600 animate-pulse">Loading…</span>
          </div>
        ) : (
          <ResponsiveLine
            data={[{ id: label, data }]}
            margin={{ top: 4, right: 4, bottom: 32, left: leftMargin }}
            xScale={{ type: "time", format: "%Y-%m-%d", precision: "day" }}
            xFormat="time:%b %d"
            yScale={{ type: "linear", min: 0, nice: true }}
            axisBottom={{
              format: "%b %d",
              tickValues: xTickValues,
              tickSize: 0,
              tickPadding: 8,
            }}
            axisLeft={{
              tickSize: 0,
              tickPadding: 6,
              tickValues: 3,
              format: formatAxis,
            }}
            enableGridX={false}
            gridYValues={3}
            curve="monotoneX"
            pointSize={0}
            enableArea
            areaOpacity={0.08}
            colors={["#9e9990"]}
            theme={nivoTheme}
            isInteractive
            enableCrosshair={false}
            tooltip={({ point }) => (
              <div className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
                <span className="text-zinc-400">{String(point.data.xFormatted)}</span>
                {" — "}
                <span className="font-medium">
                  {formatTooltip ? formatTooltip(point.data.y) : String(point.data.y)}
                </span>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 space-y-3 min-w-[160px]">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-xs text-zinc-500">{label}</p>
      </div>
      <p className={`text-2xl font-semibold tracking-tight tabular-nums ${
        loading ? "text-zinc-700 animate-pulse" : "text-zinc-100"
      }`}>
        {loading ? "———" : value}
      </p>
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatAxisCost(usd: number): string {
  if (usd === 0) return "0";
  if (usd < 0.01) return usd.toFixed(4);
  if (usd < 1) return usd.toFixed(3);
  return usd.toFixed(2);
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatErrorRate(rate: number): string {
  if (rate === 0) return "0%";
  if (rate < 0.001) return "<0.1%";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
