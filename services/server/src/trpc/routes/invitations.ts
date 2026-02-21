import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { invitation, member, user } from "../../db/schema.js";
import { env } from "../../env.js";
import { requireOrgRole, requireOrgMember } from "../orgAccess.js";

export const invitationsRouter = router({
  create: authedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        email: z.string().email(),
        role: z.enum(["member", "admin", "owner"]).default("member"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgRole(ctx.user.id, ctx.user.role, input.organizationId, [
        "owner",
        "admin",
      ]);

      // Check if the email already belongs to a member of this org.
      const [existingUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, input.email));
      if (existingUser) {
        const [existingMember] = await db
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.organizationId, input.organizationId),
              eq(member.userId, existingUser.id)
            )
          );
        if (existingMember) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This user is already a member of the project.",
          });
        }
      }

      // Check for an existing pending invitation for this email.
      const [existingInvite] = await db
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, input.organizationId),
            eq(invitation.email, input.email),
            eq(invitation.status, "pending")
          )
        );
      if (existingInvite) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A pending invitation already exists for this email.",
        });
      }

      const id = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const [inv] = await db
        .insert(invitation)
        .values({
          id,
          organizationId: input.organizationId,
          email: input.email,
          role: input.role,
          status: "pending",
          expiresAt,
          inviterId: ctx.user.id,
        })
        .returning();
      return {
        ...inv,
        inviteUrl: `${env.appBaseUrl}/accept-invite?token=${inv.id}`,
      };
    }),

  list: authedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.organizationId);
      const invitations = await db
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, input.organizationId),
            eq(invitation.status, "pending")
          )
        );
      return invitations.map((inv) => ({
        ...inv,
        inviteUrl: `${env.appBaseUrl}/accept-invite?token=${inv.id}`,
      }));
    }),

  delete: authedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [inv] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, input.invitationId));
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });

      await requireOrgRole(ctx.user.id, ctx.user.role, inv.organizationId, [
        "owner",
        "admin",
      ]);
      await db.delete(invitation).where(eq(invitation.id, input.invitationId));
    }),
});
