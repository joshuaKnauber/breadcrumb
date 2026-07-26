import { breadcrumb } from "@breadcrumb-sh/core";
import { sqlite } from "@breadcrumb-sh/core/adapters";

/**
 * Reads the database the playground writes to, so this example has traces in it
 * without needing its own traffic:
 *
 *   npm run dev --workspace=examples/playground   # produces traces
 *   npm run dev --workspace=examples/next         # shows them
 */
export const bc = breadcrumb({
  database: sqlite("../playground/.breadcrumb/playground.db"),
  basePath: "/api/breadcrumb",
  environment: "development",
});
