import { Route, Routes } from "react-router-dom";
import { SessionsView, SessionDetail } from "./SessionsView.js";
import { CostView } from "./CostView.js";
import { McpView } from "./McpView.js";
import { TraceView } from "./TraceView.js";
import { Sidebar } from "./Sidebar.js";

export function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-plate">
        <Routes>
          <Route path="/" element={<SessionsView />} />
          <Route path="/sessions/:sessionKey" element={<SessionDetail />} />
          <Route path="/sessions/:sessionKey/traces/:traceId" element={<TraceView />} />
          <Route path="/cost" element={<CostView />} />
          <Route path="/mcp" element={<McpView />} />
        </Routes>
      </main>
    </div>
  );
}
