import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import "./chart.js";
import { api, fmtInt, fmtMoney } from "./api.js";
import type { CostGroup, CostSummary } from "./types.js";

// Neutral lightness ramp, assigned by cost rank: the biggest spender is
// brightest. Structure through value, not hue. Overflow ranks → darkest gray.
const MODEL_COLORS = ["#e2e2e2", "#a8a8a8", "#767676", "#525252"];
const OTHER_COLOR = "#3a3a3a";

const WINDOWS = [7, 14, 30] as const;

export function CostView({ environment }: { environment?: string }) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(14);
  const cost = useQuery({
    queryKey: ["cost", days, environment],
    queryFn: () => api.cost(days, environment),
  });

  const colorForModel = useMemo(() => {
    const map = new Map<string | null, string>();
    (cost.data?.byModel ?? []).forEach((m, i) => {
      map.set(m.key, i < MODEL_COLORS.length ? MODEL_COLORS[i]! : OTHER_COLOR);
    });
    return (key: string | null) => map.get(key) ?? OTHER_COLOR;
  }, [cost.data]);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-8 pt-6 pb-16">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-[15px] font-semibold">Cost</h1>
          <span className="text-[12px] text-faint">USD</span>
          <div className="ml-auto flex gap-0.5 rounded-md bg-panel p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={`rounded px-2.5 py-1 font-mono text-[12px] ${
                  days === w ? "bg-panel2 text-fg" : "text-faint hover:text-muted"
                }`}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>

        {cost.isLoading && <div className="text-faint">loading…</div>}
        {cost.data && cost.data.totals.cost === 0 && (
          <div className="rounded-md bg-panel px-4 py-8 text-center text-faint">
            No cost recorded in this window. Spans need a model with known pricing, or an explicit cost.
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

            <CostChart summary={cost.data} colorForModel={colorForModel} />

            <Legend models={cost.data.byModel} colorForModel={colorForModel} total={cost.data.totals.cost} />

            <FunctionTable functions={cost.data.byFunction} total={cost.data.totals.cost} />
          </>
        )}
      </div>
    </div>
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
    <div className="rounded-md bg-panel px-4 py-3">
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
}: {
  summary: CostSummary;
  colorForModel: (key: string | null) => string;
}) {
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
          backgroundColor: "#202020",
          borderColor: "#2a2a2a",
          borderWidth: 1,
          padding: 10,
          titleColor: "#ececec",
          bodyColor: "#989898",
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
          ticks: { maxRotation: 0, autoSkipPadding: 16 },
          border: { display: false },
        },
        y: {
          stacked: true,
          grid: { color: "#ffffff0a" },
          border: { display: false },
          ticks: { callback: (v) => fmtMoney(Number(v)) },
        },
      },
    };

    return { data: chartData, options: chartOptions };
  }, [summary, colorForModel, range]);

  return (
    <div className="mb-3 rounded-md bg-panel p-4">
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
      <div className="overflow-hidden rounded-md bg-panel">
        {functions.map((f) => {
          const share = (f.cost / total) * 100;
          return (
            <div key={String(f.key)} className="relative flex items-center gap-3 px-4 py-2.5">
              <span
                className="absolute inset-y-0 left-0 bg-accent/8"
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
