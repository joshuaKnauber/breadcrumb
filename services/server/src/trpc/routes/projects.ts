import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, procedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { projects } from "../../db/schema.js";

export const projectsRouter = router({
  list: procedure.query(async () => {
    return db.select().from(projects).orderBy(projects.createdAt);
  }),

  create: procedure
    .input(z.object({ name: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const [project] = await db
        .insert(projects)
        .values({ name: input.name })
        .returning();
      return project;
    }),

  rename: procedure
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const [project] = await db
        .update(projects)
        .set({ name: input.name })
        .where(eq(projects.id, input.id))
        .returning();
      return project;
    }),

  delete: procedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(projects).where(eq(projects.id, input.id));
    }),
});
