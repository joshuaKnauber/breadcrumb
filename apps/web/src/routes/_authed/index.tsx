import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";

export const Route = createFileRoute("/_authed/")({
  component: IndexPage,
});

function IndexPage() {
  const health = trpc.health.useQuery();

  return (
    <main className="p-6">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-sm font-medium text-zinc-400">Server Status</h2>
        <p className="mt-1 text-2xl font-semibold">
          {health.data?.status === "ok" ? (
            <span className="text-emerald-400">Connected</span>
          ) : (
            <span className="text-zinc-500">Connecting...</span>
          )}
        </p>
      </div>
    </main>
  );
}
