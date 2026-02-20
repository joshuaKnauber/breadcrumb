import { ResponsiveLine } from "@nivo/line";
import { CurrencyDollar, Pulse } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "../../../../lib/trpc";

export const Route = createFileRoute("/_authed/projects/$projectId/")({
  component: OverviewPage,
});

const DAYS = 30;

function OverviewPage() {
  const { projectId } = Route.useParams();
  const stats = trpc.traces.stats.useQuery({ projectId });
  const daily = trpc.traces.dailyCount.useQuery({ projectId, days: DAYS });

  const chartData = buildChartData(daily.data ?? [], DAYS);

  return (
    <main className="p-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon={<Pulse size={16} className="text-zinc-400" />}
          label="Total traces"
          value={stats.data ? String(stats.data.traceCount) : "—"}
          loading={stats.isLoading}
        />
        <StatCard
          icon={<CurrencyDollar size={16} className="text-zinc-400" />}
          label="Total cost"
          value={stats.data ? formatCost(stats.data.totalCostUsd) : "—"}
          loading={stats.isLoading}
        />
      </div>

      {/* Traces per day chart */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-sm font-medium text-zinc-300 mb-5">
          Traces per day (last 30 days)
        </p>
        <div style={{ height: 180 }}>
          {daily.isLoading ? (
            <div className="h-full flex items-center justify-center">
              <span className="text-xs text-zinc-600 animate-pulse">
                Loading…
              </span>
            </div>
          ) : (
            <ResponsiveLine
              data={[{ id: "traces", data: chartData }]}
              margin={{ top: 8, right: 8, bottom: 36, left: 36 }}
              xScale={{ type: "time", format: "%Y-%m-%d", precision: "day" }}
              xFormat="time:%b %d"
              yScale={{ type: "linear", min: 0, nice: true }}
              axisBottom={{
                format: "%b %d",
                tickValues: "every 7 days",
                tickSize: 0,
                tickPadding: 10,
              }}
              axisLeft={{
                tickSize: 0,
                tickPadding: 8,
                tickValues: 4,
              }}
              enableGridX={false}
              gridYValues={4}
              curve="monotoneX"
              pointSize={0}
              enableArea
              areaOpacity={0.08}
              colors={["#a1a1aa"]}
              theme={nivoTheme}
              isInteractive
              enableCrosshair={false}
              tooltip={({ point }) => (
                <div className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
                  <span className="text-zinc-400">
                    {String(point.data.xFormatted)}
                  </span>
                  {" — "}
                  <span className="font-medium">
                    {String(point.data.y)} traces
                  </span>
                </div>
              )}
            />
          )}
        </div>
      </div>
    </main>
  );
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

function buildChartData(rows: { date: string; count: number }[], days: number) {
  const map = new Map(rows.map((r) => [r.date, r.count]));
  const data: { x: string; y: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    data.push({ x: key, y: map.get(key) ?? 0 });
  }
  return data;
}

const nivoTheme = {
  background: "transparent",
  text: { fill: "#71717a", fontSize: 11 },
  axis: {
    ticks: { text: { fill: "#71717a" } },
    legend: { text: { fill: "#71717a" } },
  },
  grid: { line: { stroke: "#27272a", strokeWidth: 1 } },
  crosshair: { line: { stroke: "#52525b" } },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs text-zinc-500">{label}</p>
      </div>
      <p
        className={`text-2xl font-semibold tracking-tight ${
          loading ? "text-zinc-700 animate-pulse" : "text-zinc-100"
        }`}
      >
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
