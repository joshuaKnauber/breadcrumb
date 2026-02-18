import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/query-keys";

async function fetchMe() {
  const res = await fetch("/auth/me");
  const data = await res.json();
  return data.authenticated as boolean;
}

async function login(password: string) {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error("Invalid password");
}

async function logout() {
  await fetch("/auth/logout", { method: "POST" });
}

export function useAuth() {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: fetchMe,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => queryClient.setQueryData(queryKeys.auth.me, true),
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.setQueryData(queryKeys.auth.me, false),
  });

  return {
    authenticated: me.data ?? false,
    isLoading: me.isLoading,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error,
    logout: logoutMutation.mutateAsync,
  };
}
