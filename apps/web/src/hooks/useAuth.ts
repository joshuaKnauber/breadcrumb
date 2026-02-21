import { authClient } from "../lib/auth-client";

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();

  const user = session?.user ?? null;
  // Better Auth returns additionalFields on the user object
  const role = (user as { role?: string } | null)?.role ?? "user";

  return {
    user,
    authenticated: !!user,
    isLoading: isPending,
    login: (email: string, password: string) =>
      authClient.signIn.email({ email, password }),
    logout: () => authClient.signOut(),
    role,
    isAdmin: role === "admin",
  };
}
