import { Link } from "@tanstack/react-router";
import { UserMenu } from "./UserMenu";

/**
 * Simple app-level header for non-project pages (projects list, new project).
 * Project pages use the merged header in the $projectId layout instead.
 */
export function AppHeader() {
  return (
    <header className="border-b border-zinc-800 px-4 sm:px-8">
      <div className="flex items-center justify-between h-[53px]">
        <Link
          to="/"
          className="flex items-center hover:opacity-80 transition-opacity"
        >
          <img src="/logo.svg" alt="Breadcrumb" className="h-5" />
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}
