import { useState } from "react";
import { SessionsView } from "./SessionsView.js";

const TABS = ["Sessions", "Failures", "Cost"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>("Sessions");
  const [environment, setEnvironment] = useState<string>("");

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 flex-none items-center gap-6 border-b border-line px-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="h-2 w-2 rounded-[2px] bg-accent" />
          breadcrumb
        </div>
        <nav className="flex h-full">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className={`-mb-px border-b-2 px-3.5 ${
                tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="ml-auto">
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px]"
          >
            <option value="">all environments</option>
            <option value="production">production</option>
            <option value="preview">preview</option>
            <option value="development">development</option>
          </select>
        </div>
      </header>

      {tab === "Sessions" ? (
        <SessionsView environment={environment || undefined} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-faint">
          {tab} — coming next
        </div>
      )}
    </div>
  );
}
