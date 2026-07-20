import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtInt, fmtMoney } from "./api.js";
import type { CostGroup, CostSummary } from "./types.js";

// Categorical palette, dark-ground safe. Assigned to models by cost rank, so
// the biggest spender always gets the most distinct hue. Overflow → "other".
const MODEL_COLORS = ["#e8a33d", "#6fb3e0", "#b790e8", "#5bb98b", "#e089a7"];
const OTHER_COLOR = "#5c636d";

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
          <span className="text-[12px] text-faint">estimated from token usage</span>
          <div className="ml-auto flex gap-1 rounded-md border border-line p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={`rounded px-2.5 py-1 font-mono text-[12px] ${
                  days === w ? "bg-panel2 text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>

        {cost.isLoading && <div className="text-faint">loading…</div>}
        {cost.data && cost.data.totals.cost === 0 && (
          <div className="rounded-lg border border-line bg-panel px-4 py-8 text-center text-faint">
            No cost recorded in this window. Spans need a model with known pricing, or an explicit cost.
          </div>
        )}
        {cost.data && cost.data.totals.cost > 0 && (
          <>
            <div className="mb-6 grid grid-cols-3 gap-3">
              <Tile label="total cost" value={fmtMoney(cost.data.totals.cost)} accent />
              <Tile label="input tokens" value={fmtInt(cost.data.totals.inputTokens)} />
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

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="font-mono text-[11px] tracking-wider text-faint uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? "text-accent" : ""}`}>{value}</div>
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
  const modelOrder = summary.byModel.map((m) => m.key);
  const range = utcDayRange(summary.windowDays);

  // day -> model -> cost
  const byDay = new Map<string, Map<string | null, number>>();
  for (const d of summary.days) {
    const m = byDay.get(d.day) ?? new Map();
    m.set(d.model, (m.get(d.model) ?? 0) + d.cost);
    byDay.set(d.day, m);
  }
  const dayTotal = (day: string) =>
    [...(byDay.get(day)?.values() ?? [])].reduce((a, c) => a + c, 0);
  const max = Math.max(...range.map(dayTotal), 0.0001);

  return (
    <div className="mb-3 rounded-lg border border-line bg-panel p-4">
      <div className="flex gap-2">
        <div className="relative h-48 w-12 flex-none font-mono text-[10px] text-faint tabular-nums">
          <span className="absolute top-0 right-1">{fmtMoney(max)}</span>
          <span className="absolute top-1/2 right-1 -translate-y-1/2">{fmtMoney(max / 2)}</span>
          <span className="absolute right-1 bottom-0">$0</span>
        </div>
        <div className="relative h-48 flex-1">
          <div className="absolute inset-0 flex flex-col justify-between">
            <div className="border-t border-line/50" />
            <div className="border-t border-line/50" />
            <div className="border-t border-line" />
          </div>
          <div className="absolute inset-0 flex items-end gap-px">
            {range.map((day) => {
              const total = dayTotal(day);
              const models = byDay.get(day);
              return (
                <div key={day} className="flex h-full flex-1 flex-col justify-end">
                  <div className="flex flex-col-reverse" style={{ height: `${(total / max) * 100}%` }}>
                    {modelOrder.map((mk) => {
                      const c = models?.get(mk) ?? 0;
                      if (c === 0) return null;
                      return (
                        <div
                          key={String(mk)}
                          title={`${day} · ${mk ?? "unknown"}: ${fmtMoney(c)}`}
                          style={{ height: `${(c / total) * 100}%`, background: colorForModel(mk) }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-14 font-mono text-[10px] text-faint">
        <span>{range[0]?.slice(5)}</span>
        <span>{range[range.length - 1]?.slice(5)}</span>
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
      <div className="overflow-hidden rounded-lg border border-line">
        {functions.map((f, i) => {
          const share = (f.cost / total) * 100;
          return (
            <div
              key={String(f.key)}
              className={`relative flex items-center gap-3 px-3.5 py-2.5 ${
                i > 0 ? "border-t border-panel2" : ""
              }`}
            >
              <span
                className="absolute inset-y-0 left-0 bg-accent/8"
                style={{ width: `${share}%` }}
                aria-hidden
              />
              <span className="relative z-10 min-w-0 flex-1 truncate font-medium">{f.key ?? "unknown"}</span>
              <span className="relative z-10 font-mono text-[12px] text-muted tabular-nums">
                {f.count === 1 ? "1 run" : `${fmtInt(f.count)} runs`}
              </span>
              <span className="relative z-10 w-24 text-right font-mono text-[12px] text-muted tabular-nums">
                {fmtInt(f.inputTokens + f.outputTokens)} tok
              </span>
              <span className="relative z-10 w-20 text-right font-mono text-[13px] font-medium text-accent tabular-nums">
                {fmtMoney(f.cost)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
