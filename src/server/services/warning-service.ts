import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

export type WarningRevocationResult =
  | {
      outcome: "revoked";
      warningActionId: string;
      remainingWarningCount: number;
      chatId: string;
      affectedUserId: string;
    }
  | {
      outcome: "already_revoked";
      warningActionId: string;
      remainingWarningCount: number;
      chatId: string;
      affectedUserId: string;
    }
  | { outcome: "not_found" };

export async function countActiveWarningRecords(input: {
  chatId: string;
  affectedUserId: string;
  warningExpiryDays: number;
  now?: Date;
}) {
  const cutoff = input.warningExpiryDays > 0
    ? new Date((input.now ?? new Date()).getTime() - input.warningExpiryDays * 24 * 60 * 60 * 1000)
    : null;

  return prisma.moderationAction.count({
    where: {
      chatId: input.chatId,
      affectedUserId: input.affectedUserId,
      type: "WARNING",
      status: "SUCCEEDED",
      revokedAt: null,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {})
    }
  });
}

/**
 * Revokes either a specific warning (appeal) or the latest active warning
 * (/unwarn), then derives ChatMember.warningCount from the remaining entity
 * rows. The counter is therefore a cache, never the authority.
 */
export async function revokeWarningRecord(input: {
  chatId: string;
  affectedUserId: string;
  warningActionId?: string;
  revokedByAdminId: string | null;
  revocationReason: string;
  audit?: {
    source: "ADMIN" | "SYSTEM" | "TELEGRAM";
    actingAdminId: string | null;
    metadata?: Prisma.InputJsonObject;
  };
}): Promise<WarningRevocationResult> {
  const candidate = input.warningActionId
    ? await prisma.moderationAction.findFirst({
        where: {
          id: input.warningActionId,
          chatId: input.chatId,
          affectedUserId: input.affectedUserId,
          type: "WARNING",
          status: "SUCCEEDED"
        },
        select: { id: true, revokedAt: true }
      })
    : await prisma.moderationAction.findFirst({
        where: {
          chatId: input.chatId,
          affectedUserId: input.affectedUserId,
          type: "WARNING",
          status: "SUCCEEDED",
          revokedAt: null
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, revokedAt: true }
      });

  if (!candidate) return { outcome: "not_found" };

  if (candidate.revokedAt) {
    const remainingWarningCount = await countActiveWarningRecords({
      chatId: input.chatId,
      affectedUserId: input.affectedUserId,
      warningExpiryDays: 0
    });
    return {
      outcome: "already_revoked",
      warningActionId: candidate.id,
      remainingWarningCount,
      chatId: input.chatId,
      affectedUserId: input.affectedUserId
    };
  }

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.moderationAction.updateMany({
      where: { id: candidate.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedByAdminId: input.revokedByAdminId,
        revocationReason: input.revocationReason.slice(0, 500)
      }
    });

    if (claimed.count === 0) {
      const remainingWarningCount = await tx.moderationAction.count({
        where: {
          chatId: input.chatId,
          affectedUserId: input.affectedUserId,
          type: "WARNING",
          status: "SUCCEEDED",
          revokedAt: null
        }
      });
      return {
        outcome: "already_revoked" as const,
        warningActionId: candidate.id,
        remainingWarningCount,
        chatId: input.chatId,
        affectedUserId: input.affectedUserId
      };
    }

    const remainingWarningCount = await tx.moderationAction.count({
      where: {
        chatId: input.chatId,
        affectedUserId: input.affectedUserId,
        type: "WARNING",
        status: "SUCCEEDED",
        revokedAt: null
      }
    });
    const membership = await tx.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: input.chatId,
          userId: input.affectedUserId
        }
      },
      select: { id: true, lastAutoEscalationWarningCount: true }
    });
    if (membership) {
      await tx.chatMember.update({
        where: { id: membership.id },
        data: {
          warningCount: remainingWarningCount,
          lastAutoEscalationWarningCount: Math.min(
            membership.lastAutoEscalationWarningCount,
            remainingWarningCount
          )
        }
      });
    }
    if (input.audit) {
      await tx.auditLog.create({
        data: {
          chatId: input.chatId,
          affectedUserId: input.affectedUserId,
          actingAdminId: input.audit.actingAdminId,
          source: input.audit.source,
          action: "MODERATION_UNWARN",
          metadata: {
            ...(input.audit.metadata ?? {}),
            warningActionId: candidate.id,
            warningCount: remainingWarningCount
          }
        }
      });
    }

    return {
      outcome: "revoked" as const,
      warningActionId: candidate.id,
      remainingWarningCount,
      chatId: input.chatId,
      affectedUserId: input.affectedUserId
    };
  });
}

export async function linkWarningToTriggeredPunishment(
  warningActionId: string,
  punishmentActionId: string
) {
  await prisma.moderationAction.updateMany({
    where: {
      id: warningActionId,
      type: "WARNING",
      triggeredPunishmentActionId: null
    },
    data: { triggeredPunishmentActionId: punishmentActionId }
  });
}
