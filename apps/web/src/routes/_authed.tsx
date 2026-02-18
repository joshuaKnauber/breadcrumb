import {
  createFileRoute,
  Outlet,
  useNavigate,
  Link,
} from "@tanstack/react-router";
import { SignOut } from "@phosphor-icons/react";
import { useAuth } from "../hooks/useAuth";

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  const auth = useAuth();
  const navigate = useNavigate();

  if (auth.isLoading) return null;

  if (!auth.authenticated) {
    navigate({ to: "/login" });
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <Link to="/" className="text-lg font-semibold tracking-tight">
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
      <Outlet />
    </div>
  );
}
