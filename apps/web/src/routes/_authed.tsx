import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  if (isPending) return null;

  if (!session) {
    navigate({ to: "/login" });
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Outlet />
    </div>
  );
}
