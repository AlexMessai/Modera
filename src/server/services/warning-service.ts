import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { forwardModerationEventToLogChannel } from "@/server/services/log-channel-service";

const SERIALIZABLE_RETRY_LIMIT = 3;

class WarningClaimConflict extends Error {}

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
  warningsResetAt?: Date | null;
  now?: Date;
}) {
  const expiryCutoff = input.warningExpiryDays > 0
    ? new Date((input.now ?? new Date()).getTime() - input.warningExpiryDays * 24 * 60 * 60 * 1000)
    : null;
  // Whichever floor is later wins: a per-level escalation reset always beats
  // an older expiry-days cutoff, since it's a strictly more recent "nothing
  // before this counts" point.
  const cutoff = expiryCutoff && input.warningsResetAt
    ? (expiryCutoff > input.warningsResetAt ? expiryCutoff : input.warningsResetAt)
    : expiryCutoff ?? input.warningsResetAt ?? null;

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
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      const forwardPayload: { value: { chatTitle: string; targetDisplayName: string } | null } = { value: null };
      const result = await prisma.$transaction(async (tx) => {
        // Selection belongs to the same SERIALIZABLE transaction as the
        // claim. If two /unwarn calls select the same newest row, Postgres
        // aborts one transaction; the retry then selects the next warning
        // instead of incorrectly returning NO_WARNINGS.
        const candidate = input.warningActionId
          ? await tx.moderationAction.findFirst({
              where: {
                id: input.warningActionId,
                chatId: input.chatId,
                affectedUserId: input.affectedUserId,
                type: "WARNING",
                status: "SUCCEEDED"
              },
              select: { id: true, revokedAt: true }
            })
          : await tx.moderationAction.findFirst({
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

        if (!candidate) return { outcome: "not_found" as const };

        if (candidate.revokedAt) {
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

        const claimed = await tx.moderationAction.updateMany({
          where: { id: candidate.id, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revokedByAdminId: input.revokedByAdminId,
            revocationReason: input.revocationReason.slice(0, 500)
          }
        });

        if (claimed.count === 0) {
          throw new WarningClaimConflict();
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

        const [chat, user] = await Promise.all([
          tx.chat.findUnique({ where: { id: input.chatId }, select: { title: true } }),
          tx.telegramUser.findUnique({ where: { id: input.affectedUserId }, select: { displayName: true, telegramUserId: true } })
        ]);
        forwardPayload.value = {
          chatTitle: chat?.title ?? "Чат",
          targetDisplayName: user?.displayName ?? user?.telegramUserId?.toString() ?? "Участник"
        };

        return {
          outcome: "revoked" as const,
          warningActionId: candidate.id,
          remainingWarningCount,
          chatId: input.chatId,
          affectedUserId: input.affectedUserId
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (forwardPayload.value) {
        const payload = forwardPayload.value;
        await forwardModerationEventToLogChannel({
          chatId: input.chatId,
          chatTitle: payload.chatTitle,
          action: "UNWARN",
          targetDisplayName: payload.targetDisplayName,
          reason: null
        }).catch(() => undefined);
      }

      return result;
    } catch (error) {
      const retryable =
        error instanceof WarningClaimConflict ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034");
      if (!retryable || attempt === SERIALIZABLE_RETRY_LIMIT - 1) throw error;
    }
  }

  // The loop either returns or throws. Kept for exhaustive TypeScript flow.
  throw new Error("Warning revocation retry limit exhausted.");
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
