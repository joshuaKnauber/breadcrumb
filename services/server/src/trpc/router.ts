import { router, procedure } from "./trpc.js";
import { projectsRouter } from "./routes/projects.js";
import { apiKeysRouter } from "./routes/apiKeys.js";
import { tracesRouter } from "./routes/traces.js";

export const appRouter = router({
  health: procedure.query(() => ({ status: "ok" })),
  projects: projectsRouter,
  apiKeys: apiKeysRouter,
  traces: tracesRouter,
});

export type AppRouter = typeof appRouter;
