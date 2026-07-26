"use client";
import { useSessions } from "@breadcrumb-sh/react";

/**
 * A page the dashboard doesn't ship, mounted into its nav. It reads trace data
 * through the same hooks the built-in pages use, so it does not need its own
 * client, provider or fetch layer.
 */
export function Evals() {
  const sessions = useSessions();
  const items = sessions.data?.items ?? [];
  const failing = items.filter((s) => s.errorCount > 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="max-w-[760px] rounded-md border border-line bg-panel p-4">
        <h2 className="mb-2 text-[13px] font-semibold">Eval candidates</h2>
        <p className="mb-4 text-[12.5px] text-muted">
          {failing.length} of {items.length} sessions failed and are worth turning into cases.
        </p>
        {failing.map((s) => (
          <div key={s.sessionKey} className="border-t border-line py-2 text-[12.5px]">
            <span className="font-medium">{s.userId ?? s.sessionKey}</span>
            <span className="ml-2 font-mono text-[11.5px] text-err">{s.failName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
