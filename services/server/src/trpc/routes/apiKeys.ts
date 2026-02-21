import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, authedProcedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { apiKeys } from "../../db/schema.js";
import {
  generateApiKey,
  hashApiKey,
  getKeyPrefix,
} from "../../lib/api-keys.js";
import {
  requireOrgMember,
  requireOrgRole,
  getApiKeyOrg,
} from "../orgAccess.js";

export const apiKeysRouter = router({
  list: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
      return db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.projectId, input.projectId))
        .orderBy(apiKeys.createdAt);
    }),

  create: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgRole(ctx.user.id, ctx.user.role, input.projectId, [
        "admin",
        "owner",
      ]);
      const rawKey = generateApiKey();
      const [key] = await db
        .insert(apiKeys)
        .values({
          projectId: input.projectId,
          name: input.name,
          keyHash: hashApiKey(rawKey),
          keyPrefix: getKeyPrefix(rawKey),
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          createdAt: apiKeys.createdAt,
        });

      return { ...key, rawKey };
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = await getApiKeyOrg(input.id);
      await requireOrgRole(ctx.user.id, ctx.user.role, orgId, [
        "admin",
        "owner",
      ]);
      await db.delete(apiKeys).where(eq(apiKeys.id, input.id));
    }),
});
