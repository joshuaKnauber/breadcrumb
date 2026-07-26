"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { HOME, parseRoute, routePath, type Route } from "./router.js";

export interface Navigation {
  route: Route;
  go: (route: Route, options?: { replace?: boolean }) => void;
  /** The href a link should carry, for middle-click and "open in new tab". */
  href: (route: Route) => string;
}

const NavigationContext = createContext<Navigation | null>(null);

export function useNavigation(): Navigation {
  const nav = useContext(NavigationContext);
  if (!nav) throw new Error("Breadcrumb views must render inside <BreadcrumbDashboard>.");
  return nav;
}

/** The env filter travels with the route, so a filtered page stays filtered when shared. */
export function useEnvironmentRoute(): { env: string | undefined; setEnv: (v: string) => void } {
  const { route, go } = useNavigation();
  const setEnv = useCallback(
    (next: string) => go({ ...route, env: next || undefined }, { replace: true }),
    [route, go]
  );
  return { env: route.env, setEnv };
}

export interface NavigationProviderProps {
  /**
   * Where the dashboard page is mounted, e.g. "/admin/traces". Supplying it
   * turns on address-bar sync so traces are deep-linkable; without it the route
   * lives in component state and the host URL is never touched.
   */
  basePath?: string;
  /** Controlled mode: the host owns the route and maps it onto its own router. */
  route?: Route;
  onNavigate?: (route: Route, options?: { replace?: boolean }) => void;
  /** What to render before the address bar is read. See the prop docs. */
  initialRoute?: Route;
  /** Names of host-supplied pages, so `/prompts` parses as a route we know. */
  custom: string[];
  children: ReactNode;
}

export function NavigationProvider({
  basePath,
  route: controlled,
  onNavigate,
  initialRoute,
  custom,
  children,
}: NavigationProviderProps) {
  const synced = basePath != null && controlled === undefined;
  const base = basePath === "/" ? "" : (basePath ?? "").replace(/\/$/, "");

  // Server and first client render must agree, so the address bar is read in an
  // effect rather than during render. `initialRoute` is how a server-rendered
  // host closes the gap: given it, the first paint is already the right page.
  const [internal, setInternal] = useState<Route>(initialRoute ?? HOME);

  useEffect(() => {
    if (!synced) return;
    const read = () => {
      const path = window.location.pathname.startsWith(base)
        ? window.location.pathname.slice(base.length)
        : window.location.pathname;
      return parseRoute(path || "/", window.location.search, custom);
    };
    setInternal(read());
    const onPop = () => setInternal(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // `custom` is spread so a page list that is rebuilt each render doesn't resubscribe.
  }, [synced, base, custom.join(",")]);

  const route = controlled ?? internal;

  const href = useCallback((next: Route) => `${base}${routePath(next)}`, [base]);

  const go = useCallback(
    (next: Route, options?: { replace?: boolean }) => {
      onNavigate?.(next, options);
      if (controlled !== undefined) return;
      setInternal(next);
      if (!synced) return;
      const url = `${base}${routePath(next)}`;
      if (options?.replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    },
    [base, controlled, onNavigate, synced]
  );

  const value = useMemo<Navigation>(() => ({ route, go, href }), [route, go, href]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

/**
 * An anchor that navigates internally. Real href so middle-click and
 * open-in-new-tab work when the dashboard is URL-synced, but plain clicks are
 * intercepted so the host's router never sees them.
 */
export function RouteLink({
  to,
  className,
  children,
  ...rest
}: { to: Route; className?: string; children: ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
>) {
  const { go, href } = useNavigation();
  return (
    <a
      {...rest}
      href={href(to)}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
