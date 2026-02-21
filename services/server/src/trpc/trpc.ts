import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

export type TRPCContext = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  } | null;
  session: { id: string; userId: string } | null;
};

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson });

export const router = t.router;
export const procedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});
