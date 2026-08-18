import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { mapTelegramMembershipStatus } from "@/server/services/member-service";
import type { TelegramChatMember } from "@/server/telegram/types";

function isMuted(member: TelegramChatMember) {
  return member.status === "restricted" && member.can_send_messages === false;
}

function punishmentFromTelegram(member: TelegramChatMember) {
  if (member.status === "kicked") {
    return {
      punishmentState: "BANNED" as string | null,
      punishmentExpiresAt: member.until_date ? new Date(member.until_date * 1000) : null
    };
  }
  if (isMuted(member)) {
    return {
      punishmentState: "MUTED" as string | null,
      punishmentExpiresAt: member.until_date ? new Date(member.until_date * 1000) : null
    };
  }
  return { punishmentState: null, punishmentExpiresAt: null };
}

function pendingMatches(type: string, member: TelegramChatMember) {
  switch (type) {
    case "MUTE": return isMuted(member);
    case "UNMUTE": return !isMuted(member) && member.status !== "kicked";
    case "BAN": return member.status === "kicked";
    case "UNBAN": return member.status !== "kicked";
    default: return false;
  }
}

function auditAction(type: string, source: string) {
  if (source === "SYSTEM") {
    if (type === "MUTE") return "AUTOMOD_AUTO_MUTE";
    if (type === "BAN") return "AUTOMOD_AUTO_BAN";
  }
  return `MODERATION_${type}`;
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.InputJsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Prisma.InputJsonObject;
  }
  return {};
}

export async function reconcileTelegramMemberState(input: {
  chatId: string;
  member: TelegramChatMember;
  eventAt: Date;
}) {
  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(input.member.user.id) },
    select: { id: true }
  });
  if (!user) return { reconciled: false, reason: "USER_UNKNOWN" as const };

  const membership = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId: input.chatId, userId: user.id } }
  });
  if (!membership) return { reconciled: false, reason: "MEMBERSHIP_UNKNOWN" as const };
  if (membership.lastModerationAt && input.eventAt < membership.lastModerationAt) {
    return { reconciled: false, reason: "STALE_EVENT" as const };
  }

  const punishment = punishmentFromTelegram(input.member);
  const status = mapTelegramMembershipStatus(input.member.status);
  const stateChanged =
    membership.punishmentState !== punishment.punishmentState ||
    membership.punishmentExpiresAt?.getTime() !== punishment.punishmentExpiresAt?.getTime();

  const pending = await prisma.moderationAction.findMany({
    where: {
      chatId: input.chatId,
      affectedUserId: user.id,
      status: "PENDING",
      type: { in: ["MUTE", "UNMUTE", "BAN", "UNBAN"] }
    },
    orderBy: { createdAt: "asc" },
    take: 10
  });
  const confirmed = pending.filter((action) => pendingMatches(action.type, input.member));
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.chatMember.update({
      where: { id: membership.id },
      data: {
        status,
        punishmentState: punishment.punishmentState,
        punishmentExpiresAt: punishment.punishmentExpiresAt,
        ...(status === "BANNED" || status === "LEFT" ? { leftAt: input.eventAt } : { leftAt: null })
      }
    });

    if (stateChanged) {
      await tx.auditLog.create({
        data: {
          chatId: input.chatId,
          affectedUserId: user.id,
          source: "TELEGRAM",
          action: punishment.punishmentState ? "PUNISHMENT_STATE_CONFIRMED" : "PUNISHMENT_STATE_CLEARED",
          metadata: {
            telegramStatus: input.member.status,
            previousPunishmentState: membership.punishmentState,
            punishmentState: punishment.punishmentState,
            punishmentExpiresAt: punishment.punishmentExpiresAt?.toISOString() ?? null
          }
        }
      });
    }

    for (const action of confirmed) {
      await tx.moderationAction.update({
        where: { id: action.id },
        data: {
          status: "SUCCEEDED",
          completedAt: now,
          telegramError: null,
          metadata: {
            ...jsonObject(action.metadata),
            reconciledAt: now.toISOString(),
            telegramStatus: input.member.status,
            reconciliation: "chat_member_update"
          }
        }
      });
      await tx.auditLog.create({
        data: {
          chatId: input.chatId,
          affectedUserId: user.id,
          actingAdminId: action.actingAdminId,
          source: action.source,
          action: auditAction(action.type, action.source),
          reason: action.reason,
          metadata: {
            moderationActionId: action.id,
            reconciled: true,
            telegramStatus: input.member.status
          }
        }
      });
    }
  });

  return { reconciled: true, stateChanged, confirmedPending: confirmed.length };
}