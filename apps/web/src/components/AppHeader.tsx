import { Link } from "@tanstack/react-router";
import { UserMenu } from "./UserMenu";

/**
 * Simple app-level header for non-project pages (projects list, new project).
 * Project pages use the merged header in the $projectId layout instead.
 */
export function AppHeader() {
  return (
    <header className="border-b border-zinc-800 px-8">
      <div className="flex items-center justify-between h-[53px]">
        <Link to="/" className="text-sm font-semibold text-zinc-100 hover:text-zinc-50 transition-colors">
          Breadcrumb
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}
