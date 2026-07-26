export interface McpOptions {
  /**
   * What MCP clients register this server as. Defaults to "breadcrumb", or
   * "breadcrumb-local" when reached over a loopback address, so a developer can
   * connect their local and deployed instances at once without the second
   * `mcp add` overwriting the first. Set it explicitly when you run more than
   * two, e.g. "breadcrumb-staging".
   */
  name?: string;
  /**
   * Hide the captured prompt/completion payloads from the agent. Everything else
   * — timings, tokens, cost, model, status, errors — stays queryable, so an
   * agent can still diagnose a failing run without reading user content.
   */
  hidePayloads?: boolean;
}

function isLoopback(hostname: string): boolean {
  // URL.hostname keeps the brackets on IPv6 literals.
  const h = hostname.replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    /^127\./.test(h) ||
    h.endsWith(".localhost")
  );
}

/**
 * The name to advertise and to print in the dashboard's connect snippets. Both
 * callers go through here so the snippet can never disagree with what the server
 * actually reports to the client.
 */
export function resolveMcpServerName(options: McpOptions, request: Request): string {
  if (options.name) return options.name;
  try {
    return isLoopback(new URL(request.url).hostname) ? "breadcrumb-local" : "breadcrumb";
  } catch {
    return "breadcrumb";
  }
}
