import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { mapTelegramMembershipStatus } from "@/server/services/member-service";
import { getTelegramClient, TelegramApiError } from "@/server/telegram/client";
import type { TelegramChatMember } from "@/server/telegram/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReconciliationSource = "chat_member_update" | "manual_get_chat_member";

type LiveMemberReader = (input: {
  chatTelegramId: number;
  userTelegramId: number;
}) => Promise<TelegramChatMember>;

export class ModerationReconciliationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "ModerationReconciliationError";
  }
}

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

export function pendingActionMatchesTelegramState(type: string, member: TelegramChatMember) {
  switch (type) {
    case "MUTE":
      return isMuted(member);
    case "UNMUTE":
      return !isMuted(member) && member.status !== "kicked";
    case "BAN":
      return member.status === "kicked";
    case "UNBAN":
      return member.status !== "kicked";
    case "KICK":
      // Kick is ban-then-immediately-unban, so its finished state looks the
      // same on Telegram's side as UNBAN — no lingering "kicked" status.
      return member.status !== "kicked";
    default:
      return false;
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
  reconciliation?: ReconciliationSource;
}) {
  const reconciliation = input.reconciliation ?? "chat_member_update";
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

  const rawPunishment = punishmentFromTelegram(input.member);
  const preserveCaptchaPending =
    membership.punishmentState === "CAPTCHA_PENDING" && isMuted(input.member);
  const punishment = preserveCaptchaPending
    ? { punishmentState: membership.punishmentState, punishmentExpiresAt: membership.punishmentExpiresAt }
    : rawPunishment;
  const status = preserveCaptchaPending ? membership.status : mapTelegramMembershipStatus(input.member.status);
  const stateChanged =
    membership.punishmentState !== punishment.punishmentState ||
    membership.punishmentExpiresAt?.getTime() !== punishment.punishmentExpiresAt?.getTime();

  const pending = await prisma.moderationAction.findMany({
    where: {
      chatId: input.chatId,
      affectedUserId: user.id,
      status: "PENDING",
      type: { in: ["MUTE", "UNMUTE", "BAN", "UNBAN", "KICK"] }
    },
    orderBy: { createdAt: "asc" },
    take: 10
  });
  const confirmed = pending.filter((action) =>
    pendingActionMatchesTelegramState(action.type, input.member)
  );
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
          action: punishment.punishmentState
            ? "PUNISHMENT_STATE_CONFIRMED"
            : "PUNISHMENT_STATE_CLEARED",
          metadata: {
            telegramStatus: input.member.status,
            previousPunishmentState: membership.punishmentState,
            punishmentState: punishment.punishmentState,
            punishmentExpiresAt: punishment.punishmentExpiresAt?.toISOString() ?? null,
            reconciliation
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
            reconciliation
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
            telegramStatus: input.member.status,
            reconciliation
          }
        }
      });
    }
  });

  return { reconciled: true, stateChanged, confirmedPending: confirmed.length };
}

async function defaultLiveMemberReader(input: {
  chatTelegramId: number;
  userTelegramId: number;
}) {
  return getTelegramClient().getChatMember(input.chatTelegramId, input.userTelegramId);
}

function reconciliationErrorMessage(error: unknown) {
  if (error instanceof TelegramApiError || error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return "Telegram не вернул состояние участника.";
}

export async function reconcilePendingModerationActionLive(
  input: {
    actionId: string;
    actingAdminId: string;
  },
  dependencies?: {
    readMember?: LiveMemberReader;
  }
) {
  if (!UUID_PATTERN.test(input.actionId)) {
    throw new ModerationReconciliationError(
      "INVALID_ACTION_ID",
      "Некорректный идентификатор действия.",
      400
    );
  }

  const action = await prisma.moderationAction.findUnique({
    where: { id: input.actionId },
    include: {
      chat: { select: { id: true, title: true, telegramChatId: true } },
      affectedUser: {
        select: { id: true, displayName: true, telegramUserId: true }
      }
    }
  });

  if (!action) {
    throw new ModerationReconciliationError(
      "ACTION_NOT_FOUND",
      "Действие модерации не найдено.",
      404
    );
  }

  if (action.status !== "PENDING") {
    return {
      outcome: "already_resolved" as const,
      actionId: action.id,
      actionStatus: action.status,
      telegramStatus: null as string | null,
      confirmedPending: 0
    };
  }

  if (!(["MUTE", "UNMUTE", "BAN", "UNBAN", "KICK"] as string[]).includes(action.type)) {
    throw new ModerationReconciliationError(
      "ACTION_NOT_RECONCILABLE",
      "Это действие не требует сверки с Telegram.",
      409
    );
  }

  const readMember = dependencies?.readMember ?? defaultLiveMemberReader;
  let telegramMember: TelegramChatMember;
  try {
    telegramMember = await readMember({
      chatTelegramId: Number(action.chat.telegramChatId),
      userTelegramId: Number(action.affectedUser.telegramUserId)
    });
  } catch (error) {
    const message = reconciliationErrorMessage(error);
    await prisma.auditLog.create({
      data: {
        chatId: action.chatId,
        affectedUserId: action.affectedUserId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "MODERATION_RECONCILIATION_CHECK_FAILED",
        reason: message,
        metadata: {
          moderationActionId: action.id,
          expectedAction: action.type
        }
      }
    });
    throw new ModerationReconciliationError(
      "TELEGRAM_RECONCILIATION_FAILED",
      `Не удалось получить актуальное состояние участника: ${message}`,
      502
    );
  }

  const matchedBefore = pendingActionMatchesTelegramState(action.type, telegramMember);
  const result = await reconcileTelegramMemberState({
    chatId: action.chatId,
    member: telegramMember,
    eventAt: new Date(),
    reconciliation: "manual_get_chat_member"
  });

  const refreshed = await prisma.moderationAction.findUniqueOrThrow({
    where: { id: action.id },
    select: { status: true, completedAt: true }
  });
  const confirmed = refreshed.status === "SUCCEEDED";

  await prisma.auditLog.create({
    data: {
      chatId: action.chatId,
      affectedUserId: action.affectedUserId,
      actingAdminId: input.actingAdminId,
      source: "ADMIN",
      action: "MODERATION_RECONCILIATION_CHECKED",
      reason: confirmed
        ? "Telegram подтвердил ожидаемое состояние участника."
        : "Текущее состояние Telegram не подтверждает зависшее действие; запись оставлена PENDING.",
      metadata: {
        moderationActionId: action.id,
        expectedAction: action.type,
        telegramStatus: telegramMember.status,
        expectedStateMatched: matchedBefore,
        confirmed,
        confirmedPending:
          "confirmedPending" in result ? result.confirmedPending : 0
      }
    }
  });

  return {
    outcome: confirmed ? ("confirmed" as const) : ("not_confirmed" as const),
    actionId: action.id,
    actionStatus: refreshed.status,
    telegramStatus: telegramMember.status,
    confirmedPending: "confirmedPending" in result ? result.confirmedPending : 0
  };
}