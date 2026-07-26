import { Valv } from "@valv/core";
import { createMcpServer } from "@valv/mcp-sdk";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SqliteAdapter } from "@valv/sqlite";
import { PostgresAdapter } from "@valv/postgres";
import type { DatabaseAdapter } from "../db/types.js";
import { SPANS_TABLE } from "../db/schema.js";
import { spanSchema } from "./schema.js";
import { resolveMcpServerName, type McpOptions } from "./config.js";

export type { McpOptions };

// Identity advertised over the wire, not the package version — see serverInfo below.
const PROTOCOL_IDENTITY_VERSION = "1";

function valvAdapter(adapter: DatabaseAdapter) {
  const schema = spanSchema(adapter.id);
  const client = adapter.client();
  return adapter.id === "sqlite"
    ? new SqliteAdapter(client as never, { schema })
    : new PostgresAdapter(client as never, { schema });
}

/**
 * Build the valv instance the MCP server fronts. The schema declares exactly one
 * resource, so `deny-all` plus a single allow rule means the agent can reach the
 * span table and nothing else — notably not `breadcrumb_mcp_keys`, whose hashes
 * would otherwise be readable through the very keys they authenticate.
 */
export async function createTraceValv(
  adapter: DatabaseAdapter,
  options: McpOptions = {}
): Promise<Valv<unknown, string>> {
  const valv = new Valv<unknown, string>({
    adapter: valvAdapter(adapter),
    defaultPolicy: "deny-all",
  });

  valv.policy(SPANS_TABLE, () => ({
    read: true,
    ...(options.hidePayloads ? { fields: { deny: ["input", "output"] } } : {}),
  }));

  // valv refuses to serve tools until its schema is loaded. Ours is declared,
  // not introspected, so this only hands the catalog over — no database hit.
  await valv.loadSchema();
  return valv;
}

/**
 * A fetch handler serving MCP over streamable HTTP, for mounting inside the
 * app's own router. Stateless: a fresh server and transport per request, which
 * is what lets this run unchanged on serverless and edge runtimes where no
 * instance survives between calls.
 */
export function createMcpHandler(
  valv: Valv<unknown, string>,
  options: McpOptions = {}
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const server = createMcpServer(valv, {
      context: {},
      // Only set so the client shows "breadcrumb" rather than valv's own
      // default identity. MCP requires a version alongside the name; it is
      // display metadata, not something callers branch on, and the package
      // version isn't reliably readable once the bundler flattens dist/.
      serverInfo: {
        name: resolveMcpServerName(options, request),
        version: PROTOCOL_IDENTITY_VERSION,
      },
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // Reply with a complete JSON body instead of opening an SSE stream. These
      // tools are request/response — nothing streams, and nothing pushes
      // notifications — and a buffered body is what makes the teardown below
      // safe, since there is no open stream left to truncate.
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      // Per-request lifecycle: nothing here outlives the response, so tear both
      // down rather than leaking a transport per call.
      void transport.close();
      void server.close();
    }
  };
}
