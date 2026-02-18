import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, procedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { apiKeys } from "../../db/schema.js";
import {
  generateApiKey,
  hashApiKey,
  getKeyPrefix,
} from "../../lib/api-keys.js";

export const apiKeysRouter = router({
  list: procedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
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

  create: procedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ input }) => {
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

      // Raw key only returned on creation — can't be retrieved later
      return { ...key, rawKey };
    }),

  delete: procedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(apiKeys).where(eq(apiKeys.id, input.id));
    }),
});
