import { createFileRoute, Link } from "@tanstack/react-router";
import { Pulse, Gear } from "@phosphor-icons/react";

export const Route = createFileRoute("/_authed/projects/$projectId/")({
  component: ProjectHomePage,
});

function ProjectHomePage() {
  const { projectId } = Route.useParams();

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Traces</h2>
        <Link
          to="/projects/$projectId/settings"
          params={{ projectId }}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
        >
          <Gear size={16} />
          Settings
        </Link>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-16 text-center">
        <Pulse size={32} className="text-zinc-600 mb-3" />
        <p className="text-sm text-zinc-400">No traces yet</p>
        <p className="mt-1 text-xs text-zinc-500">
          Send your first trace using the SDK to see it here.
        </p>
      </div>
    </main>
  );
}
