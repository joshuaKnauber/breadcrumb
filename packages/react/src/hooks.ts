"use client";
/**
 * Hooks for reading Breadcrumb data. `<BreadcrumbDashboard>` is built on these,
 * so a custom page dropped into it reaches the same data the built-in pages do:
 *
 *   <BreadcrumbProvider basePath="/admin/traces">
 *     <YourDashboard />
 *
 * Then inside: const { data } = useSessions({ environment: "prod" }).
 */
import { createContext, createElement, useContext, useState, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  createBreadcrumbClient,
  type BreadcrumbClient,
  type BreadcrumbClientOptions,
  type CostSummary,
  type ListOptions,
  type McpKeyRecord,
  type Page,
  type RunSummary,
  type SessionSummary,
  type SpanRecord,
  type Stats,
  type TraceFilter,
  type TraceSummary,
} from "@breadcrumb-sh/core/client";

/** Extra react-query options callers may pass, minus the parts we own. */
type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T>, "queryKey" | "queryFn">;

const ClientContext = createContext<BreadcrumbClient | null>(null);

export interface BreadcrumbProviderProps extends BreadcrumbClientOptions {
  /** Supply a preconfigured client instead of the inline `basePath`/`fetch` options. */
  client?: BreadcrumbClient;
  children: ReactNode;
}

export function BreadcrumbProvider({ client, children, ...options }: BreadcrumbProviderProps) {
  // Stable for the provider's lifetime; the client is stateless config.
  const [value] = useState<BreadcrumbClient>(() => client ?? createBreadcrumbClient(options));
  return createElement(ClientContext.Provider, { value }, children);
}

/** The configured client, for imperative calls outside of hooks. */
export function useBreadcrumbClient(): BreadcrumbClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("Breadcrumb hooks require a <BreadcrumbProvider> ancestor.");
  return client;
}

export function useSessions(
  filter?: ListOptions,
  options?: QueryOpts<Page<SessionSummary>>
): UseQueryResult<Page<SessionSummary>, Error> {
  const client = useBreadcrumbClient();
  return useQuery({ queryKey: ["breadcrumb", "sessions", filter], queryFn: () => client.listSessions(filter), ...options });
}

export function useTraces(
  filter?: ListOptions,
  options?: QueryOpts<Page<TraceSummary>>
): UseQueryResult<Page<TraceSummary>, Error> {
  const client = useBreadcrumbClient();
  return useQuery({ queryKey: ["breadcrumb", "traces", filter], queryFn: () => client.listTraces(filter), ...options });
}

export function useRuns(
  sessionKey: string,
  options?: QueryOpts<RunSummary[]>
): UseQueryResult<RunSummary[], Error> {
  const client = useBreadcrumbClient();
  return useQuery({ queryKey: ["breadcrumb", "runs", sessionKey], queryFn: () => client.listRuns(sessionKey), ...options });
}

export function useTrace(
  traceId: string | null | undefined,
  options?: QueryOpts<SpanRecord[]>
): UseQueryResult<SpanRecord[], Error> {
  const client = useBreadcrumbClient();
  return useQuery({
    queryKey: ["breadcrumb", "trace", traceId],
    queryFn: () => client.getTrace(traceId!),
    enabled: traceId != null,
    ...options,
  });
}

export function useSpan(
  id: string | null | undefined,
  options?: QueryOpts<SpanRecord | null>
): UseQueryResult<SpanRecord | null, Error> {
  const client = useBreadcrumbClient();
  return useQuery({
    queryKey: ["breadcrumb", "span", id],
    queryFn: () => client.getSpan(id!),
    enabled: id != null,
    ...options,
  });
}

export function useCost(
  params?: { days?: number; environment?: string },
  options?: QueryOpts<CostSummary>
): UseQueryResult<CostSummary, Error> {
  const client = useBreadcrumbClient();
  return useQuery({ queryKey: ["breadcrumb", "cost", params], queryFn: () => client.cost(params), ...options });
}

export function useStats(
  filter?: TraceFilter,
  options?: QueryOpts<Stats>
): UseQueryResult<Stats, Error> {
  const client = useBreadcrumbClient();
  return useQuery({ queryKey: ["breadcrumb", "stats", filter], queryFn: () => client.stats(filter), ...options });
}

export function useEnvironments(options?: QueryOpts<string[]>): UseQueryResult<string[], Error> {
  const client = useBreadcrumbClient();
  return useQuery({
    queryKey: ["breadcrumb", "environments"],
    queryFn: () => client.listEnvironments(),
    staleTime: 60_000,
    ...options,
  });
}

export interface McpKeys {
  keys: McpKeyRecord[];
  /** The name the server identifies as, so connect snippets can't disagree. */
  serverName: string;
}

export function useMcpKeys(options?: QueryOpts<McpKeys>): UseQueryResult<McpKeys, Error> {
  const client = useBreadcrumbClient();
  return useQuery({ queryKey: MCP_KEYS, queryFn: () => client.listMcpKeys(), ...options });
}

export function useCreateMcpKey(): UseMutationResult<
  { key: McpKeyRecord; token: string },
  Error,
  string
> {
  const client = useBreadcrumbClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => client.createMcpKey(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MCP_KEYS }),
  });
}

export function useRevokeMcpKey(): UseMutationResult<void, Error, string> {
  const client = useBreadcrumbClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.revokeMcpKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MCP_KEYS }),
  });
}

const MCP_KEYS = ["breadcrumb", "mcp-keys"] as const;

export { createBreadcrumbClient } from "@breadcrumb-sh/core/client";
export type { BreadcrumbClient, BreadcrumbClientOptions } from "@breadcrumb-sh/core/client";
