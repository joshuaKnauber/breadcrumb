import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
import { SessionsView } from "./SessionsView.js";
import { CostView } from "./CostView.js";

const TABS = [
  { to: "/", label: "Sessions", end: true },
  { to: "/failures", label: "Failures", end: false },
  { to: "/cost", label: "Cost", end: false },
];

export function App() {
  const [environment, setEnvironment] = useState<string>("");
  const env = environment || undefined;

  const environments = useQuery({
    queryKey: ["environments"],
    queryFn: api.environments,
    staleTime: 60_000,
  });
  const options = environments.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 flex-none items-center gap-6 border-b border-line px-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="h-2 w-2 rounded-[2px] bg-accent" />
          breadcrumb
        </div>
        <nav className="flex h-full">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `-mb-px flex items-center border-b-2 px-3.5 ${
                  isActive ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto">
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            disabled={options.length === 0}
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] disabled:opacity-50"
          >
            <option value="">all environments</option>
            {options.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<SessionsView environment={env} />} />
        <Route path="/cost" element={<CostView environment={env} />} />
        <Route
          path="/failures"
          element={<div className="flex flex-1 items-center justify-center text-faint">Failures — coming next</div>}
        />
      </Routes>
    </div>
  );
}
