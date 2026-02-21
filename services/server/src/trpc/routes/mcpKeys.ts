import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, authedProcedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { mcpKeys } from "../../db/schema.js";
import {
  generateMcpKey,
  hashApiKey,
  getKeyPrefix,
} from "../../lib/api-keys.js";
import { requireOrgMember, getMcpKeyOrg } from "../orgAccess.js";

export const mcpKeysRouter = router({
  list: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
      return db
        .select({
          id: mcpKeys.id,
          name: mcpKeys.name,
          keyPrefix: mcpKeys.keyPrefix,
          createdAt: mcpKeys.createdAt,
        })
        .from(mcpKeys)
        .where(eq(mcpKeys.projectId, input.projectId))
        .orderBy(mcpKeys.createdAt);
    }),

  create: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
      const rawKey = generateMcpKey();
      const [key] = await db
        .insert(mcpKeys)
        .values({
          projectId: input.projectId,
          name: input.name,
          keyHash: hashApiKey(rawKey),
          keyPrefix: getKeyPrefix(rawKey),
        })
        .returning({
          id: mcpKeys.id,
          name: mcpKeys.name,
          keyPrefix: mcpKeys.keyPrefix,
          createdAt: mcpKeys.createdAt,
        });

      return { ...key, rawKey };
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = await getMcpKeyOrg(input.id);
      await requireOrgMember(ctx.user.id, ctx.user.role, orgId);
      await db.delete(mcpKeys).where(eq(mcpKeys.id, input.id));
    }),
});
