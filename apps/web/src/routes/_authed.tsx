import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
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
      <Outlet />
    </div>
  );
}
