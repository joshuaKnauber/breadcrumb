import { initTRPC } from "@trpc/server";
import superjson from "superjson";

const t = initTRPC.create({ transformer: superjson });

export const appRouter = t.router({
  health: t.procedure.query(() => ({ status: "ok" })),
});

export type AppRouter = typeof appRouter;
