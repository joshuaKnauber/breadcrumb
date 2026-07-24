import { useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
import { SessionsView, SessionDetail } from "./SessionsView.js";
import { CostView } from "./CostView.js";

const TABS = [
  { to: "/", label: "Sessions", match: (p: string) => p === "/" || p.startsWith("/sessions") },
  { to: "/cost", label: "Cost", match: (p: string) => p.startsWith("/cost") },
];

export function App() {
  const [environment, setEnvironment] = useState<string>("");
  const env = environment || undefined;
  const { pathname } = useLocation();

  const environments = useQuery({
    queryKey: ["environments"],
    queryFn: api.environments,
    staleTime: 60_000,
  });
  const options = environments.data ?? [];

  return (
    <div className="flex h-full">
      <aside className="flex w-52 flex-none flex-col px-3 py-4">
        <div className="px-2.5 font-semibold">breadcrumb</div>
        <nav className="mt-7 grid gap-0.5">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={`rounded-md px-2.5 py-1.5 text-[13px] ${
                t.match(pathname) ? "bg-panel font-medium text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-0.5">
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            disabled={options.length === 0}
            className="w-full rounded-md bg-panel px-2 py-1.5 text-[12.5px] text-muted disabled:opacity-50"
          >
            <option value="">all environments</option>
            {options.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </aside>

      <div className="min-w-0 flex-1 py-2 pr-2">
        <main className="flex h-full overflow-hidden rounded-lg bg-plate">
          <Routes>
            <Route path="/" element={<SessionsView environment={env} />} />
            <Route path="/sessions/:sessionKey" element={<SessionDetail />} />
            <Route path="/cost" element={<CostView environment={env} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
