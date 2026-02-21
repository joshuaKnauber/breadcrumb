import { router, procedure } from "./trpc.js";
import { projectsRouter } from "./routes/projects.js";
import { apiKeysRouter } from "./routes/apiKeys.js";
import { mcpKeysRouter } from "./routes/mcpKeys.js";
import { tracesRouter } from "./routes/traces.js";
import { membersRouter } from "./routes/members.js";
import { invitationsRouter } from "./routes/invitations.js";

export const appRouter = router({
  health: procedure.query(() => ({ status: "ok" })),
  projects: projectsRouter,
  apiKeys: apiKeysRouter,
  mcpKeys: mcpKeysRouter,
  traces: tracesRouter,
  members: membersRouter,
  invitations: invitationsRouter,
});

export type AppRouter = typeof appRouter;
