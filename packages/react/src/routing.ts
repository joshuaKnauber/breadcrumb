/**
 * Route parsing, free of React and safe to call on the server.
 *
 *   import { parseRoute } from "@breadcrumb-sh/react/routing";
 *
 * It lives on its own entry point because the main one is marked "use client":
 * a server component may render the dashboard, but it cannot call a function
 * from a client module, and building `initialRoute` is exactly that.
 */
export {
  parseRoute,
  routePath,
  BUILTIN_PAGES,
  HOME,
  type Page,
  type Route,
} from "./dashboard/router.js";
