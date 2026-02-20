import { Link, useNavigate } from "@tanstack/react-router";
import { SignOut } from "@phosphor-icons/react";
import { useAuth } from "../hooks/useAuth";

/**
 * Simple app-level header for non-project pages (projects list, new project).
 * Project pages use the merged header in the $projectId layout instead.
 */
export function AppHeader() {
  const auth = useAuth();
  const navigate = useNavigate();

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
      <Link to="/" className="text-sm font-semibold tracking-tight text-zinc-100 hover:text-white transition-colors">
        Breadcrumb
      </Link>
      <button
        onClick={() => auth.logout().then(() => navigate({ to: "/login" }))}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
      >
        <SignOut size={16} />
        Logout
      </button>
    </header>
  );
}
