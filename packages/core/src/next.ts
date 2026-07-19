import type { Breadcrumb } from "./index.js";

type Handler = (request: Request) => Promise<Response>;

/**
 * Next.js catch-all route handlers. In
 * app/admin/traces/[[...breadcrumb]]/route.ts:
 *
 *   export const { GET, POST, DELETE } = toNextHandler(bc);
 *
 * Gate the UI with the `authorize` option on breadcrumb() or with middleware.
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
