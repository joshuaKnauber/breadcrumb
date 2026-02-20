import { useState, useEffect, useRef } from "react";
import { ResponsiveLine } from "@nivo/line";
import { CurrencyDollar, Pulse, Timer, XCircle, CaretDown, Check, CalendarBlank } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "../../../../lib/trpc";
import { useTheme } from "../../../../hooks/useTheme";

export const Route = createFileRoute("/_authed/projects/$projectId/")({
  component: OverviewPage,
});

type Metric = "traces" | "cost" | "errors";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function presetFrom(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

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
    <main className="px-8 py-7 space-y-6">

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
      <div className="flex gap-4">
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
      <div className="grid grid-cols-2 gap-4">
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
      <div className="grid grid-cols-2 gap-4">
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

// ── DateRangePopover ───────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function DateRangePopover({
  from,
  to,
  preset,
  onPreset,
  onCustom,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  preset: 7 | 30 | 90 | null;
  onPreset: (d: 7 | 30 | 90) => void;
  onCustom: () => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(preset === null);
  const ref = useRef<HTMLDivElement>(null);

  // Sync panel mode each time the popover opens
  useEffect(() => {
    if (open) setShowCustom(preset === null);
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const label = preset ? `Last ${preset} days` : `${fmtDate(from)} – ${fmtDate(to)}`;

  const inputCls =
    "flex-1 h-7 rounded px-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-300 outline-none focus:border-zinc-600 [color-scheme:dark]";

  const tabCls = (active: boolean) =>
    `px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
      active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
    }`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-[30px] flex items-center gap-2 rounded-md border px-2.5 text-xs outline-none transition-colors ${
          open
            ? "border-zinc-600 bg-zinc-900 text-zinc-300"
            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
        }`}
      >
        <CalendarBlank size={12} className="shrink-0 text-zinc-500" />
        <span>{label}</span>
        <CaretDown
          size={10}
          className={`shrink-0 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-50 w-56 rounded-md border border-zinc-800 bg-zinc-900 shadow-xl p-3 space-y-3">
          {/* Preset + Custom tabs */}
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-md p-0.5 gap-0.5">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => { setShowCustom(false); onPreset(d); setOpen(false); }}
                className={tabCls(preset === d && !showCustom)}
              >
                {d}d
              </button>
            ))}
            <button
              onClick={() => { setShowCustom(true); onCustom(); }}
              className={tabCls(showCustom)}
            >
              Custom
            </button>
          </div>

          {/* Custom date inputs */}
          {showCustom && (
            <>
              <div className="h-px bg-zinc-800" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-7 shrink-0">From</span>
                  <input
                    type="date"
                    value={from}
                    max={to}
                    onChange={(e) => onFromChange(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-7 shrink-0">To</span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    max={today()}
                    onChange={(e) => onToChange(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── MultiselectCombobox ────────────────────────────────────────────────────────

function MultiselectCombobox({
  options,
  selected,
  onChange,
  placeholder = "All",
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query
    ? options.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : options;

  const toggle = (name: string) => {
    onChange(
      selected.includes(name)
        ? selected.filter((n) => n !== name)
        : [...selected, name]
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-[30px] flex items-center gap-1.5 rounded-md border px-2.5 text-xs outline-none transition-colors min-w-[120px] max-w-[200px] ${
          open
            ? "border-zinc-600 bg-zinc-900 text-zinc-300"
            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
        }`}
      >
        <span className="truncate flex-1 text-left">
          {selected.length === 0 ? (
            <span className="text-zinc-600">{placeholder}</span>
          ) : selected.length === 1 ? (
            selected[0]
          ) : (
            `${selected.length} selected`
          )}
        </span>
        <CaretDown
          size={10}
          className={`shrink-0 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-50 w-64 rounded-md border border-zinc-800 bg-zinc-900 shadow-xl">
          <div className="p-1.5">
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-7 rounded px-2.5 text-xs bg-zinc-950 border border-zinc-800 text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-600"
              autoFocus
            />
          </div>

          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-zinc-600">No options found</p>
            ) : (
              filtered.map((name) => {
                const checked = selected.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggle(name)}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-xs hover:bg-zinc-800/60 transition-colors"
                  >
                    <div
                      className={`size-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
                        checked ? "bg-zinc-400 border-zinc-400" : "border-zinc-700"
                      }`}
                    >
                      {checked && <Check size={9} weight="bold" className="text-zinc-950" />}
                    </div>
                    <span className={`truncate ${checked ? "text-zinc-200" : "text-zinc-400"}`}>
                      {name}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selected.length > 0 && (
            <div className="border-t border-zinc-800 p-1.5">
              <button
                onClick={() => onChange([])}
                className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-1 transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
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
