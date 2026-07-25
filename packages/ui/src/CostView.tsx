import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import "./chart.js";
import { api, fmtInt, fmtMoney } from "./api.js";
import type { CostGroup, CostSummary } from "./types.js";
import { useTheme } from "./theme.js";
import { ToggleGroup } from "./ui/ToggleGroup.js";
import { EnvFilter, useEnvironment } from "./ui/EnvFilter.js";
import { Loading, Skeleton } from "./ui/Skeleton.js";

// Neutral lightness ramp, assigned by cost rank: the biggest spender carries the
// most contrast against the ground. Structure through value, not hue, so the
// chart stays hueless like the rest of the chrome. Overflow ranks → faintest.
const RAMP = {
  dark: { series: ["#e2e2e2", "#a8a8a8", "#767676", "#525252"], other: "#3a3a3a" },
  light: { series: ["#26292c", "#5a6065", "#8b9198", "#b4b9bd"], other: "#d2d6d9" },
} as const;

const CHART_CHROME = {
  dark: { popup: "#1c1f21", line: "#ffffff1f", grid: "#ffffff0f", fg: "#e9eaeb", muted: "#989ca0" },
  light: { popup: "#ffffff", line: "#00000024", grid: "#00000012", fg: "#15181a", muted: "#5a6065" },
} as const;

const WINDOWS = ["7", "14", "30"] as const;
type Window = (typeof WINDOWS)[number];

export function CostView() {
  const [days, setDays] = useState<Window>("14");
  const { resolved } = useTheme();
  const { env, value: envValue, setEnv, environments } = useEnvironment();

  const cost = useQuery({
    queryKey: ["cost", days, env],
    queryFn: () => api.cost(Number(days), env),
  });

  const colorForModel = useMemo(() => {
    const ramp = RAMP[resolved];
    const map = new Map<string | null, string>();
    (cost.data?.byModel ?? []).forEach((m, i) => {
      map.set(m.key, i < ramp.series.length ? ramp.series[i]! : ramp.other);
    });
    return (key: string | null) => map.get(key) ?? ramp.other;
  }, [cost.data, resolved]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <ToggleGroup
          ariaLabel="Time window"
          value={days}
          onChange={setDays}
          options={WINDOWS.map((w) => ({ value: w, label: `${w}d` }))}
        />
        <span className="text-[12px] text-faint">USD, last {days} days</span>
        <span className="flex-1" />
        <EnvFilter value={envValue} onChange={setEnv} environments={environments} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-16">
        <div className="max-w-[900px]">
          {cost.isLoading && <CostSkeleton />}
          {cost.data && cost.data.totals.cost === 0 && (
            <div className="rounded-md border border-line bg-panel px-4 py-8 text-center text-faint">
              No cost recorded in this window. Spans need a model with known pricing, or an explicit
              cost.
            </div>
          )}
          {cost.data && cost.data.totals.cost > 0 && (
            <>
              <div className="mb-6 grid grid-cols-3 gap-3">
                <Tile label="total cost" value={fmtMoney(cost.data.totals.cost)} accent />
                <Tile
                  label="input tokens"
                  value={fmtInt(cost.data.totals.inputTokens)}
                  sub={cachedShare(cost.data.totals)}
                />
                <Tile label="output tokens" value={fmtInt(cost.data.totals.outputTokens)} />
              </div>

              <CostChart summary={cost.data} colorForModel={colorForModel} theme={resolved} />

              <Legend
                models={cost.data.byModel}
                colorForModel={colorForModel}
                total={cost.data.totals.cost}
              />

              <FunctionTable functions={cost.data.byFunction} total={cost.data.totals.cost} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Bar heights trace a plausible spend curve rather than a flat block, so the
// placeholder reads as a chart before the chart arrives.
const BAR_HEIGHTS = [38, 55, 47, 72, 61, 84, 69, 91, 58, 76, 64, 88, 51, 70];

function CostSkeleton() {
  return (
    <Loading label="Loading cost">
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-md border border-line bg-panel px-4 py-3">
            <Skeleton w={72} h={9} />
            <Skeleton w={i === 0 ? 96 : 78} h={22} className="mt-2" />
          </div>
        ))}
      </div>
      <div className="mb-3 rounded-md border border-line bg-panel p-4">
        <div className="flex h-52 items-end gap-1.5">
          {BAR_HEIGHTS.map((h, i) => (
            <Skeleton key={i} h={`${h}%`} className="flex-1" />
          ))}
        </div>
      </div>
      <div className="mb-6 flex flex-wrap gap-x-5 gap-y-1.5">
        {[104, 128, 92].map((w, i) => (
          <span key={i} className="flex items-center gap-2">
            <Skeleton w={10} h={10} />
            <Skeleton w={w} h={11} />
          </span>
        ))}
      </div>
      <Skeleton w={72} h={9} className="mb-2" />
      <div className="overflow-hidden rounded-md border border-line bg-panel">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton w={i % 2 ? 132 : 168} h={12} />
            <Skeleton w={44} h={11} className="ml-auto" />
            <Skeleton w={62} h={11} />
            <Skeleton w={56} h={12} />
          </div>
        ))}
      </div>
    </Loading>
  );
}

function cachedShare(totals: { inputTokens: number; cachedInputTokens: number }): string | null {
  if (totals.cachedInputTokens === 0 || totals.inputTokens === 0) return null;
  return `${Math.round((totals.cachedInputTokens / totals.inputTokens) * 100)}% cached`;
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3">
      <div className="font-mono text-[11px] tracking-wider text-faint uppercase">{label}</div>
      <div className={`mt-1 text-2xl tabular-nums ${accent ? "font-semibold" : "font-medium text-muted"}`}>
        {value}
        {sub && <span className="ml-2 align-middle font-mono text-[11px] font-normal text-faint">{sub}</span>}
      </div>
    </div>
  );
}

function utcDayRange(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function CostChart({
  summary,
  colorForModel,
  theme,
}: {
  summary: CostSummary;
  colorForModel: (key: string | null) => string;
  theme: "light" | "dark";
}) {
  const chrome = CHART_CHROME[theme];
  const range = utcDayRange(summary.windowDays);

  const { data, options } = useMemo(() => {
    // day -> model -> cost
    const byDay = new Map<string, Map<string | null, number>>();
    for (const d of summary.days) {
      const m = byDay.get(d.day) ?? new Map();
      m.set(d.model, (m.get(d.model) ?? 0) + d.cost);
      byDay.set(d.day, m);
    }

    const chartData: ChartData<"bar"> = {
      labels: range.map((day) => day.slice(5)),
      datasets: summary.byModel.map((m) => ({
        label: m.key ?? "unknown",
        data: range.map((day) => byDay.get(day)?.get(m.key) ?? 0),
        backgroundColor: colorForModel(m.key),
        stack: "cost",
        borderRadius: 2,
        maxBarThickness: 26,
      })),
    };

    const chartOptions: ChartOptions<"bar"> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: chrome.popup,
          borderColor: chrome.line,
          borderWidth: 1,
          padding: 10,
          titleColor: chrome.fg,
          bodyColor: chrome.muted,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}`,
          },
          filter: (item) => (item.parsed.y ?? 0) > 0,
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkipPadding: 16, color: chrome.muted },
          border: { display: false },
        },
        y: {
          stacked: true,
          grid: { color: chrome.grid },
          border: { display: false },
          ticks: { callback: (v) => fmtMoney(Number(v)), color: chrome.muted },
        },
      },
    };

    return { data: chartData, options: chartOptions };
  }, [summary, colorForModel, range, chrome]);

  return (
    <div className="mb-3 rounded-md border border-line bg-panel p-4">
      <div className="h-52">
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

function Legend({
  models,
  colorForModel,
  total,
}: {
  models: CostGroup[];
  colorForModel: (key: string | null) => string;
  total: number;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-x-5 gap-y-1.5">
      {models.map((m) => (
        <div key={String(m.key)} className="flex items-center gap-2 text-[12.5px]">
          <span className="h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: colorForModel(m.key) }} />
          <span>{m.key ?? "unknown"}</span>
          <span className="font-mono text-faint tabular-nums">
            {fmtMoney(m.cost)} · {Math.round((m.cost / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function FunctionTable({ functions, total }: { functions: CostGroup[]; total: number }) {
  return (
    <div>
      <h2 className="mb-2 font-mono text-[11px] tracking-wider text-faint uppercase">by function</h2>
      <div className="overflow-hidden rounded-md border border-line bg-panel">
        {functions.map((f) => {
          const share = (f.cost / total) * 100;
          return (
            <div key={String(f.key)} className="relative flex items-center gap-3 px-4 py-2.5">
              <span
                className="absolute inset-y-0 left-0 bg-fg/[0.055]"
                style={{ width: `${share}%` }}
                aria-hidden
              />
              <span className="relative z-10 min-w-0 flex-1 truncate font-medium">{f.key ?? "unknown"}</span>
              <span className="relative z-10 font-mono text-[12px] text-faint tabular-nums">
                {f.count === 1 ? "1 run" : `${fmtInt(f.count)} runs`}
              </span>
              <span className="relative z-10 w-24 text-right font-mono text-[12px] text-faint tabular-nums">
                {fmtInt(f.inputTokens + f.outputTokens)} tok
              </span>
              <span className="relative z-10 w-20 text-right font-mono text-[13px] font-medium tabular-nums">
                {fmtMoney(f.cost)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
