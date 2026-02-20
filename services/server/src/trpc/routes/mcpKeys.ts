import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, procedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { mcpKeys } from "../../db/schema.js";
import {
  generateMcpKey,
  hashApiKey,
  getKeyPrefix,
} from "../../lib/api-keys.js";

export const mcpKeysRouter = router({
  list: procedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
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

  create: procedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ input }) => {
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

      // Raw key only returned on creation — can't be retrieved later
      return { ...key, rawKey };
    }),

  delete: procedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(mcpKeys).where(eq(mcpKeys.id, input.id));
    }),
});
