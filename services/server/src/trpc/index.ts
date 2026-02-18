import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Context } from "hono";
import { appRouter } from "./router.js";

export type { AppRouter } from "./router.js";

export const trpcHandler = async (c: Context) => {
  return fetchRequestHandler({
    endpoint: "/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({}),
  });
};
