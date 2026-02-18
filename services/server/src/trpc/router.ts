import { router, procedure } from "./trpc.js";
import { projectsRouter } from "./routes/projects.js";
import { apiKeysRouter } from "./routes/apiKeys.js";

export const appRouter = router({
  health: procedure.query(() => ({ status: "ok" })),
  projects: projectsRouter,
  apiKeys: apiKeysRouter,
});

export type AppRouter = typeof appRouter;
