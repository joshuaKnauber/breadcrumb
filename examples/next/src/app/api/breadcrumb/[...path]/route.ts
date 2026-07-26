import { toNextHandler } from "@breadcrumb-sh/core/next";
import { bc } from "../../../../breadcrumb";

/**
 * The API half of the mount. It lives on its own path because the dashboard
 * half is a `page.tsx`, and the App Router will not put a route handler and a
 * page on the same segment.
 *
 * Guard it the way you guard the rest of your admin surface — middleware, or
 * the `authorize` option on breadcrumb().
 */
export const { GET, POST, PUT, PATCH, DELETE } = toNextHandler(bc);
