import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, procedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { projects } from "../../db/schema.js";
import { clickhouse } from "../../db/clickhouse.js";

export const projectsRouter = router({
  list: procedure.query(async () => {
    return db.select().from(projects).orderBy(projects.createdAt);
  }),

  get: procedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id));
      return project ?? null;
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
      // Delete Postgres row (cascades to api_keys) and all ClickHouse data
      // for this project in parallel. ALTER TABLE ... DELETE is a ClickHouse
      // mutation — it's asynchronous on the server side but that's fine here
      // since the project is already gone from Postgres before the UI reacts.
      await Promise.all([
        db.delete(projects).where(eq(projects.id, input.id)),
        clickhouse.command({
          query: "ALTER TABLE breadcrumb.traces DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.id },
        }),
        clickhouse.command({
          query: "ALTER TABLE breadcrumb.spans DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.id },
        }),
        clickhouse.command({
          query: "ALTER TABLE breadcrumb.trace_rollups DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.id },
        }),
      ]);
    }),
});
