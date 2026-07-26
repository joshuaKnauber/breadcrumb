import type { Breadcrumb } from "./index.js";

type Handler = (request: Request) => Promise<Response>;

/**
 * Next.js catch-all route handlers. In app/api/breadcrumb/[...path]/route.ts:
 *
 *   export const { GET, POST, DELETE } = toNextHandler(bc);
 *
 * This is the API half of a mount; the dashboard half is a page rendering
 * <BreadcrumbDashboard>, on its own path because the App Router will not put a
 * route handler and a page on the same segment.
 *
 * Gate it with the `authorize` option on breadcrumb() or with middleware.
 */
export function toNextHandler(input: Breadcrumb | Handler): {
  GET: Handler;
  POST: Handler;
  PUT: Handler;
  PATCH: Handler;
  DELETE: Handler;
} {
  const handler = typeof input === "function" ? input : input.handler;
  const h: Handler = (request) => handler(request);
  return { GET: h, POST: h, PUT: h, PATCH: h, DELETE: h };
}
