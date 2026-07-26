"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BreadcrumbClient } from "@breadcrumb-sh/core/client";
import { BreadcrumbProvider } from "../hooks.js";
import { NavigationProvider, useNavigation } from "./navigation.js";
import { PortalProvider } from "./root.js";
import { BUILTIN_PAGES, type Route } from "./router.js";
import { useTheme, type Theme } from "./theme.js";
import { Sidebar } from "./Sidebar.js";
import { SessionsView, SessionDetail } from "./SessionsView.js";
import { TraceView } from "./TraceView.js";
import { CostView } from "./CostView.js";
import { McpView } from "./McpView.js";

export interface DashboardPage {
  /** URL segment and identity, e.g. "prompts" → /prompts. */
  name: string;
  label?: string;
  icon?: ReactNode;
  /**
   * The page itself, as an element rather than a render function: a Next server
   * component can pass `<Prompts />` across the boundary, but not a function
   * that returns it.
   */
  element: ReactNode;
}

/** Built-in pages and chrome that can be left out. */
export type Hideable = "sessions" | "cost" | "mcp" | "sidebar" | "theme" | (string & {});

export interface BreadcrumbDashboardProps {
  /**
   * Where the request handler is mounted, e.g. "/api/breadcrumb". Omit only if
   * the handler answers relative to the page the dashboard renders on.
   */
  api?: string;
  /**
   * Where this page is mounted, e.g. "/admin/traces". Supplying it turns on
   * address-bar sync so individual traces are deep-linkable, which needs the
   * page to be a catch-all route. Leave it off and the route lives in
   * component state instead.
   */
  basePath?: string;
  /** Controlled routing: the host owns the route and maps it to its own router. */
  route?: Route;
  onNavigate?: (route: Route, options?: { replace?: boolean }) => void;
  /**
   * The route to render before the address bar is read, which a server-rendered
   * host knows and the server does not. Without it a deep link server-renders
   * the session list and corrects itself on hydration; with it the first paint
   * is already right. Build it from your route params with `parseRoute`.
   */
  initialRoute?: Route;
  /** Pages and chrome to leave out. */
  hide?: Hideable[];
  /** Extra pages, listed in the sidebar after the built-in ones. */
  pages?: DashboardPage[];
  /** Slave the palette to the host's own theme state; omit for a built-in toggle. */
  theme?: Theme;
  /** Bring your own client (custom fetch, auth headers) instead of `api`. */
  client?: BreadcrumbClient;
  /** Reuse an existing QueryClient instead of the dashboard's own. */
  queryClient?: QueryClient;
  className?: string;
}

/**
 * The whole dashboard as one component.
 *
 *   <BreadcrumbDashboard api="/api/breadcrumb" basePath="/admin/traces" />
 *
 * Needs the stylesheet: import "@breadcrumb-sh/react/styles.css".
 */
export function BreadcrumbDashboard({
  api,
  basePath,
  route,
  onNavigate,
  initialRoute,
  hide,
  pages,
  theme,
  client,
  queryClient,
  className = "",
}: BreadcrumbDashboardProps) {
  // Its own cache by default, so the dashboard's polling can't churn a host
  // app's query cache — and so mounting it needs no provider setup at all.
  const [ownQueryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchInterval: 5000, staleTime: 4000, retry: 1 } },
      })
  );

  return (
    <QueryClientProvider client={queryClient ?? ownQueryClient}>
      <BreadcrumbProvider client={client} basePath={api}>
        <Shell
          basePath={basePath}
          route={route}
          onNavigate={onNavigate}
          initialRoute={initialRoute}
          hide={hide}
          pages={pages}
          theme={theme}
          className={className}
        />
      </BreadcrumbProvider>
    </QueryClientProvider>
  );
}

type ShellProps = Pick<
  BreadcrumbDashboardProps,
  "basePath" | "route" | "onNavigate" | "initialRoute" | "hide" | "pages" | "theme"
> & { className: string };

function Shell({
  basePath,
  route,
  onNavigate,
  initialRoute,
  hide,
  pages,
  theme,
  className,
}: ShellProps) {
  const { theme: chosen, resolved } = useTheme(theme);
  const omitted = useMemo(() => new Set<string>(hide ?? []), [hide]);
  const custom = useMemo(() => (pages ?? []).filter((p) => !omitted.has(p.name)), [pages, omitted]);
  const names = useMemo(() => custom.map((p) => p.name), [custom]);

  const entries = useMemo(
    () => [
      ...BUILTIN_PAGES.filter((p) => !omitted.has(p)).map((page) => ({
        page: page as string,
        label: LABELS[page]!,
        icon: undefined as ReactNode,
      })),
      ...custom.map((p) => ({ page: p.name, label: p.label ?? p.name, icon: p.icon })),
    ],
    [omitted, custom]
  );

  const root = useRef<HTMLDivElement>(null);

  return (
    <NavigationProvider
      basePath={basePath}
      route={route}
      onNavigate={onNavigate}
      initialRoute={initialRoute}
      custom={names}
    >
      <PortalProvider value={root}>
        <div
          ref={root}
          // `bc-root` scopes every rule in the stylesheet — without it nothing
          // styles. Utilities are scoped as descendants of it, so the layout
          // lives on an inner element rather than on this one.
          className={`bc-root ${className}`}
          // Absent means "follow the OS", which the stylesheet resolves in CSS so
          // a system user never sees the wrong palette before hydration.
          data-theme={chosen === "system" ? undefined : resolved}
        >
          <div className="flex h-full">
            {!omitted.has("sidebar") && (
              <Sidebar entries={entries} showTheme={!omitted.has("theme")} theme={theme} />
            )}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-plate">
              <Page custom={custom} omitted={omitted} />
            </main>
          </div>
        </div>
      </PortalProvider>
    </NavigationProvider>
  );
}

const LABELS: Record<string, string> = { sessions: "Sessions", cost: "Cost", mcp: "MCP" };

function Page({ custom, omitted }: { custom: DashboardPage[]; omitted: Set<string> }) {
  const { route } = useNavigation();
  const page = custom.find((p) => p.name === route.page);
  if (page) return <>{page.element}</>;
  if (omitted.has(route.page)) return <Missing />;
  switch (route.page) {
    case "session":
      return <SessionDetail />;
    case "trace":
      return <TraceView />;
    case "cost":
      return <CostView />;
    case "mcp":
      return <McpView />;
    default:
      return <SessionsView />;
  }
}

function Missing() {
  return (
    <div className="flex flex-1 items-center justify-center text-[12.5px] text-faint">
      This page is not available.
    </div>
  );
}
