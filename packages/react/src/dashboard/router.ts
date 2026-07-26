/**
 * URL shapes for the dashboard, free of React so they can be parsed on a server
 * as easily as in the browser.
 *
 * The built-in pages are typed as a union of literals plus `string`, so a host's
 * own page is a valid route without losing completion on the ones that ship.
 */
export type Page = "sessions" | "session" | "trace" | "cost" | "mcp" | (string & {});

export const BUILTIN_PAGES = ["sessions", "cost", "mcp"] as const;

export interface Route {
  page: Page;
  sessionKey?: string;
  traceId?: string;
  /**
   * Environment is a filter on what a page shows, so it travels with the route
   * rather than living in component state: a link to a filtered page stays
   * filtered when shared, and switching pages keeps the scope.
   */
  env?: string;
  view?: "flow" | "full";
}

export const HOME: Route = { page: "sessions" };

/**
 * `custom` names the host-supplied pages, so `/prompts` resolves to a page the
 * dashboard didn't ship rather than falling back to the session list.
 */
export function parseRoute(pathname: string, search = "", custom: string[] = []): Route {
  const params = new URLSearchParams(search);
  const env = params.get("env") || undefined;
  const view = params.get("view") === "full" ? "full" : undefined;
  const path = pathname.replace(/\/+$/, "") || "/";

  const trace = path.match(/^\/sessions\/([^/]+)\/traces\/([^/]+)$/);
  if (trace) {
    return {
      page: "trace",
      sessionKey: decodeURIComponent(trace[1]!),
      traceId: decodeURIComponent(trace[2]!),
      env,
      view,
    };
  }
  const session = path.match(/^\/sessions\/([^/]+)$/);
  if (session) {
    return { page: "session", sessionKey: decodeURIComponent(session[1]!), env, view };
  }
  if (path === "/cost") return { page: "cost", env };
  if (path === "/mcp") return { page: "mcp", env };

  const name = path.slice(1);
  if (custom.includes(name)) return { page: name, env };
  return { page: "sessions", env };
}

export function routePath(route: Route): string {
  const key = route.sessionKey ? encodeURIComponent(route.sessionKey) : "";
  let path = "/";
  if (route.page === "session") path = `/sessions/${key}`;
  else if (route.page === "trace") {
    path = `/sessions/${key}/traces/${encodeURIComponent(route.traceId ?? "")}`;
  } else if (route.page !== "sessions") path = `/${route.page}`;

  const params = new URLSearchParams();
  if (route.env) params.set("env", route.env);
  if (route.page === "trace" && route.view === "full") params.set("view", "full");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
