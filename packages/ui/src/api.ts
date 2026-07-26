import { createBreadcrumbClient } from "@breadcrumb-sh/core/client";

// The dashboard is served with an injected <base href> at its mount path, so the
// client uses relative URLs (no basePath) and the same build works anywhere.
const client = createBreadcrumbClient();

export const api = {
  sessions: (environment?: string) => client.listSessions({ environment }).then((r) => r.items),
  runs: (sessionKey: string) => client.listRuns(sessionKey),
  trace: (traceId: string) => client.getTrace(traceId),
  cost: (days: number, environment?: string) => client.cost({ days, environment }),
  environments: () => client.listEnvironments(),
  mcpKeys: () => client.listMcpKeys(),
  createMcpKey: (name: string) => client.createMcpKey(name),
  revokeMcpKey: (id: string) => client.revokeMcpKey(id),
};

// Re-exported so components keep importing formatters from "./api.js".
export { fmtMs, fmtTokens, fmtCost, fmtMoney, fmtInt, fmtTime } from "@breadcrumb-sh/core/kit";
