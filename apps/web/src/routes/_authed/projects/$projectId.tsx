import { SignOut } from "@phosphor-icons/react";
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useAuth } from "../../../hooks/useAuth";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute("/_authed/projects/$projectId")({
  component: ProjectLayout,
});

const TABS = [
  { label: "Overview", path: "", exact: true },
  { label: "Traces", path: "/traces", exact: false },
  { label: "Settings", path: "/settings", exact: false },
] as const;

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const project = trpc.projects.get.useQuery({ id: projectId });
  const auth = useAuth();
  const navigate = useNavigate();

  return (
    <div>
      <header className="border-b border-zinc-800 px-6">
        {/* Nav row: app link + breadcrumb on left, logout on right */}
        <div className="flex items-center justify-between h-[53px]">
          <div className="flex items-center gap-2 text-sm">
            <Link
              to="/"
              className="font-semibold text-zinc-100 hover:text-white transition-colors"
            >
              Breadcrumb
            </Link>
            <span className="text-zinc-700 select-none">/</span>
            <span className="font-medium text-zinc-300">
              {project.data?.name ?? "…"}
            </span>
          </div>

          <button
            onClick={() => auth.logout().then(() => navigate({ to: "/login" }))}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <SignOut size={16} />
            Logout
          </button>
        </div>

        {/* Tab row */}
        <nav className="flex items-end gap-0.5 -mb-px">
          {TABS.map(({ label, path, exact }) => {
            const href = `/projects/${projectId}${path}`;
            const isActive = exact
              ? pathname === href
              : pathname.startsWith(href);

            return (
              <Link
                key={label}
                to={`/projects/$projectId${path}`}
                params={{ projectId }}
                className={`px-3 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  isActive
                    ? "border-zinc-100 text-zinc-100"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <Outlet />
    </div>
  );
}
