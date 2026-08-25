import { Prisma } from "@/generated/prisma/client";
import { notifyModerationTarget, notifyPunishmentAppealOption } from "@/server/services/appeal-notification-service";
import { forwardModerationEventToLogChannel } from "@/server/services/log-channel-service";
import { prisma } from "@/server/db/prisma";
import {
  getTelegramBotProfile,
  getTelegramClient,
  MUTED_CHAT_PERMISSIONS,
  TelegramApiError,
  UNRESTRICTED_CHAT_PERMISSIONS
} from "@/server/telegram/client";
import { extractBotPermissions } from "@/server/telegram/status";
import { isBanExpired, isMuteExpired } from "@/server/services/punishment-state";
import type { TelegramChatMember } from "@/server/telegram/types";
import { countActiveWarningRecords, revokeWarningRecord } from "@/server/services/warning-service";
import { sendPublicModerationNotification } from "@/server/services/moderation-notification-settings-service";
import { nextEscalationThreshold, resolveEffectiveModerationSettings } from "@/server/services/global-moderation-service";

export const MODERATION_ACTIONS = ["WARNING", "MUTE", "UNMUTE", "BAN", "UNBAN", "KICK"] as const;
export type ModerationActionValue = (typeof MODERATION_ACTIONS)[number];
type TelegramModerationAction = Exclude<ModerationActionValue, "WARNING">;
type ActionSource = "ADMIN" | "SYSTEM" | "TELEGRAM";

function notificationSource(source: ActionSource) {
  return source === "TELEGRAM" ? "MANUAL" as const : "AUTOMATED" as const;
}

export type TelegramActor = {
  telegramUserId: number;
  username?: string | null;
  displayName?: string | null;
};

function telegramActorMetadata(actor: TelegramActor): Prisma.InputJsonObject {
  return {
    telegramActorId: actor.telegramUserId,
    ...(actor.username ? { telegramActorUsername: actor.username } : {}),
    ...(actor.displayName ? { telegramActorDisplayName: actor.displayName } : {})
  };
}

const ACTION_AUDIT_LABELS: Record<ModerationActionValue, string> = {
  WARNING: "MODERATION_WARNING",
  MUTE: "MODERATION_MUTE",
  UNMUTE: "MODERATION_UNMUTE",
  BAN: "MODERATION_BAN",
  UNBAN: "MODERATION_UNBAN",
  KICK: "MODERATION_KICK"
};

export class ModerationError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "ModerationError";
  }
}

export function isModerationAction(value: string): value is ModerationActionValue {
  return MODERATION_ACTIONS.includes(value as ModerationActionValue);
}

// Reason used to be required for WARNING/MUTE/BAN/KICK; per product decision
// it's now optional everywhere (still recorded when given, just never
// blocks the action). Kept as a function rather than deleted outright so
// both call sites below stay a one-line no-op call instead of two separate
// deletions, and so a future reason-required action has one obvious place
// to wire back in.
export function requiresReason(action: ModerationActionValue) {
  void action;
  return false;
}

// Telegram's own banChatMember/restrictChatMember reject an until_date more
// than 366 days out (it's treated as permanent past that); mute stays capped
// at a week, matching the bound this codebase already validated before ban
// gained a duration too.
const MUTE_DURATION_MINUTES_MAX = 10080;
const BAN_DURATION_MINUTES_MAX = 366 * 24 * 60;

function assertDurationMinutes(value: number | null | undefined, code: string, message: string, max: number) {
  if (value !== undefined && value !== null && (value < 1 || value > max)) {
    throw new ModerationError(code, message, 400);
  }
}

export function isProtectedMemberStatus(status: string) {
  return status === "CREATOR" || status === "ADMINISTRATOR";
}

function isProtectedTelegramMember(member: TelegramChatMember) {
  return member.status === "creator" || member.status === "administrator";
}

function normalizeReason(reason?: string | null) {
  const normalized = reason?.trim();
  return normalized ? normalized.slice(0, 500) : null;
}

function assertLocalActionAllowed(
  action: ModerationActionValue,
  member: {
    status: string;
    punishmentState: string | null;
    punishmentExpiresAt: Date | null;
    user: { isBot: boolean };
    chat: { type: string };
  }
) {
  if (member.user.isBot) throw new ModerationError("TARGET_IS_BOT", "Действия модерации над Telegram-ботами отключены.", 409);
  if (action !== "WARNING" && isProtectedMemberStatus(member.status)) {
    throw new ModerationError("TARGET_PROTECTED", "Владельца или администратора чата нельзя ограничить этим действием.", 409);
  }
  if ((action === "MUTE" || action === "UNMUTE") && member.chat.type !== "supergroup") {
    throw new ModerationError("SUPERGROUP_REQUIRED", "Mute и unmute доступны только для Telegram supergroup.", 409);
  }
  if (action === "MUTE" && member.punishmentState === "MUTED" && !isMuteExpired(member)) {
    throw new ModerationError("ALREADY_MUTED", "Участник уже находится в mute.", 409);
  }
  if (action === "UNMUTE" && member.status !== "RESTRICTED" && member.punishmentState !== "MUTED") {
    throw new ModerationError("NOT_MUTED", "У участника нет активного mute.", 409);
  }
  if (action === "BAN" && (member.status === "BANNED" || member.punishmentState === "BANNED") && !isBanExpired(member)) {
    throw new ModerationError("ALREADY_BANNED", "Участник уже заблокирован.", 409);
  }
  if (action === "UNBAN" && member.status !== "BANNED" && member.punishmentState !== "BANNED") {
    throw new ModerationError("NOT_BANNED", "У участника нет активной блокировки.", 409);
  }
  if (action === "KICK" && (member.status === "LEFT" || member.status === "BANNED")) {
    throw new ModerationError("TARGET_NOT_IN_CHAT", "Участник уже не состоит в чате.", 409);
  }
}

async function createAction(input: {
  member: { chatId: string; userId: string; status: string; punishmentState: string | null };
  actingAdminId: string | null;
  source: ActionSource;
  action: TelegramModerationAction;
  reason: string | null;
  expiresAt?: Date | null;
  metadata?: Prisma.InputJsonObject;
}) {
  return prisma.moderationAction.create({
    data: {
      chatId: input.member.chatId,
      affectedUserId: input.member.userId,
      actingAdminId: input.actingAdminId,
      source: input.source,
      type: input.action,
      status: "PENDING",
      reason: input.reason,
      expiresAt: input.expiresAt ?? null,
      metadata: {
        previousStatus: input.member.status,
        previousPunishmentState: input.member.punishmentState,
        ...(input.metadata ?? {})
      }
    }
  });
}

async function failAction(input: {
  actionId: string;
  chatId: string;
  userId: string;
  actingAdminId: string | null;
  source: ActionSource;
  action: TelegramModerationAction;
  reason: string | null;
  error: string;
}) {
  const now = new Date();
  await prisma.$transaction([
    prisma.moderationAction.update({
      where: { id: input.actionId },
      data: { status: "FAILED", telegramError: input.error.slice(0, 500), completedAt: now }
    }),
    prisma.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.userId,
        actingAdminId: input.actingAdminId,
        source: input.source,
        action: input.source === "SYSTEM" ? "AUTOMOD_ESCALATION_FAILED" : "MODERATION_ACTION_FAILED",
        reason: input.reason,
        metadata: { moderationActionId: input.actionId, type: input.action, error: input.error.slice(0, 500) }
      }
    })
  ]);
}

async function recordWarning(input: {
  membershipId: string;
  member: {
    chatId: string;
    userId: string;
    status: string;
    punishmentState: string | null;
    lastAutoEscalationWarningCount: number;
    warningsResetAt: Date | null;
    chat: { title: string; telegramChatId: bigint };
    user: { telegramUserId: bigint; displayName?: string };
  };
  actingAdminId: string | null;
  source: ActionSource;
  reason: string | null;
  metadata?: Prisma.InputJsonObject;
  notificationAdmin?: TelegramActor;
  suppressTargetNotification?: boolean;
}) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const action = await tx.moderationAction.create({
      data: {
        chatId: input.member.chatId,
        affectedUserId: input.member.userId,
        actingAdminId: input.actingAdminId,
        source: input.source,
        type: "WARNING",
        status: "SUCCEEDED",
        reason: input.reason,
        completedAt: now,
        metadata: {
          previousStatus: input.member.status,
          previousPunishmentState: input.member.punishmentState,
          ...(input.metadata ?? {})
        }
      }
    });
    const membership = await tx.chatMember.update({ where: { id: input.membershipId }, data: { warningCount: { increment: 1 } } });
    await tx.auditLog.create({
      data: {
        chatId: input.member.chatId,
        affectedUserId: input.member.userId,
        actingAdminId: input.actingAdminId,
        source: input.source,
        action: ACTION_AUDIT_LABELS.WARNING,
        reason: input.reason,
        metadata: { moderationActionId: action.id, warningCount: membership.warningCount, ...(input.metadata ?? {}) }
      }
    });
    return { action, membership };
  });

  if (!input.suppressTargetNotification) await notifyPunishmentAppealOption({
    moderationActionId: result.action.id,
    chatId: input.member.chatId,
    telegramChatId: input.member.chat.telegramChatId,
    userId: input.member.userId,
    telegramUserId: input.member.user.telegramUserId,
    chatTitle: input.member.chat.title,
    actionType: "WARNING",
    reason: input.reason,
    notificationSource: notificationSource(input.source),
    targetDisplayName: input.member.user.displayName,
    admin: input.notificationAdmin ? {
      telegramUserId: input.notificationAdmin.telegramUserId,
      displayName: input.notificationAdmin.displayName ?? input.notificationAdmin.username ?? "Администратор"
    } : undefined
  }).catch(() => undefined);

  if (input.source === "ADMIN") {
    const { settings } = await resolveEffectiveModerationSettings(input.member.chatId);
    const activeWarningCount = await countActiveWarningRecords({
      chatId: input.member.chatId,
      affectedUserId: input.member.userId,
      warningExpiryDays: settings.warningExpiryDays,
      warningsResetAt: input.member.warningsResetAt,
      now
    });
    const warnsLimit = nextEscalationThreshold(settings.escalationRules, input.member.lastAutoEscalationWarningCount);
    await sendPublicModerationNotification({
      event: "WARNING",
      telegramChatId: input.member.chat.telegramChatId,
      target: input.member.user.displayName ?? input.member.user.telegramUserId.toString(),
      targetTelegramUserId: input.member.user.telegramUserId,
      reason: input.reason,
      warns: String(activeWarningCount),
      warnsLimit: warnsLimit !== null ? String(warnsLimit) : undefined
    }).catch(() => undefined);
  }

  await forwardModerationEventToLogChannel({
    chatId: input.member.chatId,
    chatTitle: input.member.chat.title,
    action: "WARNING",
    targetDisplayName: input.member.user.displayName ?? input.member.user.telegramUserId.toString(),
    reason: input.reason
  }).catch(() => undefined);

  return {
    id: result.action.id,
    type: result.action.type,
    status: result.action.status,
    warningCount: result.membership.warningCount,
    membershipStatus: result.membership.status,
    punishmentState: result.membership.punishmentState,
    punishmentExpiresAt: result.membership.punishmentExpiresAt?.toISOString() ?? null
  };
}

async function assertTelegramModerationAccess(input: { chatTelegramId: number; targetTelegramId: number }) {
  const client = getTelegramClient();
  const botProfile = await getTelegramBotProfile();
  const botMember = await client.getChatMember(input.chatTelegramId, botProfile.id);
  const permissions = extractBotPermissions(botMember);
  if ((botMember.status !== "administrator" && botMember.status !== "creator") || !permissions.canRestrictMembers) {
    throw new ModerationError("BOT_PERMISSION_REQUIRED", "У бота нет права ограничивать участников в этом чате.", 409);
  }
  const targetMember = await client.getChatMember(input.chatTelegramId, input.targetTelegramId);
  if (isProtectedTelegramMember(targetMember)) {
    throw new ModerationError("TARGET_PROTECTED", "Telegram не позволяет применить это действие к владельцу или администратору чата.", 409);
  }
  return { client, targetMember };
}

async function performTelegramAction(input: {
  action: TelegramModerationAction;
  chatTelegramId: number;
  targetTelegramId: number;
  expiresAt?: Date | null;
}) {
  const { client, targetMember } = await assertTelegramModerationAccess({
    chatTelegramId: input.chatTelegramId,
    targetTelegramId: input.targetTelegramId
  });
  switch (input.action) {
    case "MUTE":
      if (targetMember.status === "left" || targetMember.status === "kicked") {
        throw new ModerationError("TARGET_NOT_IN_CHAT", "Нельзя выдать mute пользователю, который не состоит в чате.", 409);
      }
      await client.restrictChatMember({
        chatId: input.chatTelegramId,
        userId: input.targetTelegramId,
        permissions: MUTED_CHAT_PERMISSIONS,
        ...(input.expiresAt ? { untilDate: Math.floor(input.expiresAt.getTime() / 1000) } : {})
      });
      break;
    case "UNMUTE":
      await client.restrictChatMember({ chatId: input.chatTelegramId, userId: input.targetTelegramId, permissions: UNRESTRICTED_CHAT_PERMISSIONS });
      break;
    case "BAN":
      await client.banChatMember({
        chatId: input.chatTelegramId,
        userId: input.targetTelegramId,
        revokeMessages: false,
        ...(input.expiresAt ? { untilDate: Math.floor(input.expiresAt.getTime() / 1000) } : {})
      });
      break;
    case "UNBAN":
      await client.unbanChatMember({ chatId: input.chatTelegramId, userId: input.targetTelegramId, onlyIfBanned: true });
      break;
    case "KICK":
      // Telegram has no standalone "remove without banning" call — same
      // ban-then-immediately-unban pattern captcha's timeout-kick already
      // uses, so the member is gone but leaves no ban record behind.
      if (targetMember.status === "left" || targetMember.status === "kicked") {
        throw new ModerationError("TARGET_NOT_IN_CHAT", "Участник уже не состоит в чате.", 409);
      }
      await client.banChatMember({ chatId: input.chatTelegramId, userId: input.targetTelegramId, revokeMessages: false });
      await client.unbanChatMember({ chatId: input.chatTelegramId, userId: input.targetTelegramId, onlyIfBanned: true });
      break;
  }
  return targetMember;
}

export function membershipUpdateFor(action: TelegramModerationAction, now: Date, expiresAt?: Date | null) {
  switch (action) {
    case "MUTE":
      return { status: "RESTRICTED" as const, punishmentState: "MUTED", punishmentExpiresAt: expiresAt ?? null, leftAt: null, lastModerationAt: now };
    case "UNMUTE":
      return { status: "MEMBER" as const, punishmentState: null, punishmentExpiresAt: null, leftAt: null, lastModerationAt: now };
    case "BAN":
      return { status: "BANNED" as const, punishmentState: "BANNED", punishmentExpiresAt: expiresAt ?? null, leftAt: now, lastModerationAt: now };
    case "UNBAN":
      return { status: "LEFT" as const, punishmentState: null, punishmentExpiresAt: null, leftAt: now, lastModerationAt: now };
    case "KICK":
      // No persistent punishment state — a kicked member can rejoin via an
      // invite link right away, same as captcha's timeout-kick today.
      return { status: "LEFT" as const, punishmentState: null, punishmentExpiresAt: null, leftAt: now, lastModerationAt: now };
  }
}

async function executeTelegramBackedAction(input: {
  member: Awaited<ReturnType<typeof loadMember>>;
  actingAdminId: string | null;
  source: ActionSource;
  action: TelegramModerationAction;
  reason: string | null;
  expiresAt?: Date | null;
  auditAction: string;
  metadata?: Prisma.InputJsonObject;
  escalationWarningCount?: number;
  notificationAdmin?: TelegramActor;
  suppressTargetNotification?: boolean;
}) {
  const member = input.member;
  if (!member) throw new ModerationError("MEMBER_NOT_FOUND", "Участник не найден.", 404);
  assertLocalActionAllowed(input.action, member);
  const action = await createAction({
    member,
    actingAdminId: input.actingAdminId,
    source: input.source,
    action: input.action,
    reason: input.reason,
    expiresAt: input.expiresAt,
    metadata: input.metadata
  });

  let telegramStatusBefore: string | null = null;
  try {
    const targetMember = await performTelegramAction({
      action: input.action,
      chatTelegramId: Number(member.chat.telegramChatId),
      targetTelegramId: Number(member.user.telegramUserId),
      expiresAt: input.expiresAt
    });
    telegramStatusBefore = targetMember.status;
  } catch (error) {
    const message = error instanceof ModerationError || error instanceof TelegramApiError ? error.message : "Telegram не выполнил действие модерации.";
    await failAction({
      actionId: action.id,
      chatId: member.chatId,
      userId: member.userId,
      actingAdminId: input.actingAdminId,
      source: input.source,
      action: input.action,
      reason: input.reason,
      error: message
    });
    if (error instanceof ModerationError) throw error;
    throw new ModerationError("TELEGRAM_ACTION_FAILED", message, 502);
  }

  const now = new Date();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const membership = await tx.chatMember.update({
        where: { id: member.id },
        data: {
          ...membershipUpdateFor(input.action, now, input.expiresAt),
          ...(input.escalationWarningCount !== undefined
            ? { lastAutoEscalationWarningCount: input.escalationWarningCount }
            // Reversing a mute/ban (however it was applied) must also release
            // whichever escalation threshold caused it -- otherwise the
            // marker stays pinned at that threshold forever, silently
            // blocking every rule at or below it for this member no matter
            // how many further warnings accumulate (real incident: a member
            // auto-banned at the threshold-6 rule, then manually unbanned,
            // went on to accumulate 149 warnings with mute/ban never firing
            // again). Reset to 0 rather than leaving anything pinned -- if
            // their warningCount is still high, the very next warning
            // re-evaluates and re-applies whatever the rules call for, which
            // is the point: undoing the punishment doesn't erase the
            // infraction count that earned it.
            : (input.action === "UNMUTE" || input.action === "UNBAN")
              ? { lastAutoEscalationWarningCount: 0 }
              : {})
        }
      });
      const completedAction = await tx.moderationAction.update({
        where: { id: action.id },
        data: {
          status: "SUCCEEDED",
          completedAt: now,
          telegramError: null,
          metadata: {
            previousStatus: member.status,
            previousPunishmentState: member.punishmentState,
            telegramStatusBefore,
            ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
            ...(input.metadata ?? {})
          } satisfies Prisma.InputJsonValue
        }
      });
      await tx.auditLog.create({
        data: {
          chatId: member.chatId,
          affectedUserId: member.userId,
          actingAdminId: input.actingAdminId,
          source: input.source,
          action: input.auditAction,
          reason: input.reason,
          metadata: {
            moderationActionId: action.id,
            telegramStatusBefore,
            membershipStatus: membership.status,
            punishmentState: membership.punishmentState,
            punishmentExpiresAt: membership.punishmentExpiresAt?.toISOString() ?? null,
            ...(input.metadata ?? {})
          }
        }
      });
      return { membership, completedAction };
    });

    if (!input.suppressTargetNotification && (input.action === "MUTE" || input.action === "BAN")) {
      await notifyPunishmentAppealOption({
        moderationActionId: updated.completedAction.id,
        chatId: member.chatId,
        telegramChatId: member.chat.telegramChatId,
        userId: member.userId,
        telegramUserId: member.user.telegramUserId,
        chatTitle: member.chat.title,
        actionType: input.action,
        reason: input.reason,
        notificationSource: notificationSource(input.source),
        targetDisplayName: member.user.displayName,
        admin: input.notificationAdmin ? {
          telegramUserId: input.notificationAdmin.telegramUserId,
          displayName: input.notificationAdmin.displayName ?? input.notificationAdmin.username ?? "Администратор"
        } : undefined
      }).catch(() => undefined);
    } else if (!input.suppressTargetNotification && (input.action === "UNMUTE" || input.action === "UNBAN" || input.action === "KICK")) {
      await notifyModerationTarget({
        chatId: member.chatId,
        telegramChatId: member.chat.telegramChatId,
        telegramUserId: member.user.telegramUserId,
        chatTitle: member.chat.title,
        actionType: input.action,
        reason: input.reason,
        notificationSource: notificationSource(input.source),
        targetDisplayName: member.user.displayName,
        admin: input.notificationAdmin ? {
          telegramUserId: input.notificationAdmin.telegramUserId,
          displayName: input.notificationAdmin.displayName ?? input.notificationAdmin.username ?? "Администратор"
        } : undefined
      }).catch(() => undefined);
    }

    if (input.source === "ADMIN") {
      const durationMinutes = input.expiresAt ? Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60_000)) : null;
      const duration = durationMinutes ? (durationMinutes % 1440 === 0 ? `${durationMinutes / 1440} дн.` : durationMinutes % 60 === 0 ? `${durationMinutes / 60} ч.` : `${durationMinutes} мин.`) : "";
      await sendPublicModerationNotification({
        event: input.action,
        telegramChatId: member.chat.telegramChatId,
        target: member.user.displayName ?? member.user.telegramUserId.toString(),
        targetTelegramUserId: member.user.telegramUserId,
        reason: input.reason,
        duration
      }).catch(() => undefined);
    }

    await forwardModerationEventToLogChannel({
      chatId: member.chatId,
      chatTitle: member.chat.title,
      action: input.action,
      targetDisplayName: member.user.displayName,
      reason: input.reason
    }).catch(() => undefined);

    return {
      id: updated.completedAction.id,
      type: updated.completedAction.type,
      status: updated.completedAction.status,
      warningCount: updated.membership.warningCount,
      membershipStatus: updated.membership.status,
      punishmentState: updated.membership.punishmentState,
      punishmentExpiresAt: updated.membership.punishmentExpiresAt?.toISOString() ?? null
    };
  } catch {
    throw new ModerationError("ACTION_RECONCILIATION_REQUIRED", "Telegram выполнил действие, но Modera не смогла завершить запись в журнал. Действие оставлено в состоянии PENDING для сверки.", 500);
  }
}

async function loadMember(membershipId: string) {
  return prisma.chatMember.findUnique({ where: { id: membershipId }, include: { user: true, chat: true } });
}

export async function executeModerationAction(input: {
  membershipId: string;
  actingAdminId: string;
  action: ModerationActionValue;
  reason?: string | null;
  muteDurationMinutes?: number | null;
  banDurationMinutes?: number | null;
}) {
  const reason = normalizeReason(input.reason);
  if (requiresReason(input.action) && !reason) throw new ModerationError("REASON_REQUIRED", "Укажите причину действия модерации.", 400);
  assertDurationMinutes(input.muteDurationMinutes, "INVALID_MUTE_DURATION", "Срок mute должен быть от 1 минуты до 7 дней.", MUTE_DURATION_MINUTES_MAX);
  assertDurationMinutes(input.banDurationMinutes, "INVALID_BAN_DURATION", "Срок бана должен быть от 1 минуты до 366 дней.", BAN_DURATION_MINUTES_MAX);

  const member = await loadMember(input.membershipId);
  if (!member) throw new ModerationError("MEMBER_NOT_FOUND", "Участник не найден.", 404);
  assertLocalActionAllowed(input.action, member);

  if (input.action === "WARNING") {
    return recordWarning({ membershipId: member.id, member, actingAdminId: input.actingAdminId, source: "ADMIN", reason });
  }

  const durationMinutes = input.action === "MUTE" ? input.muteDurationMinutes : input.action === "BAN" ? input.banDurationMinutes : null;
  const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60_000) : null;

  return executeTelegramBackedAction({
    member,
    actingAdminId: input.actingAdminId,
    source: "ADMIN",
    action: input.action,
    reason,
    expiresAt,
    auditAction: ACTION_AUDIT_LABELS[input.action],
    metadata: durationMinutes
      ? (input.action === "MUTE" ? { muteDurationMinutes: durationMinutes } : { banDurationMinutes: durationMinutes })
      : undefined
  });
}

async function loadMemberByTelegramUser(chatId: string, telegramUserId: number) {
  return prisma.chatMember.findFirst({
    where: { chatId, user: { telegramUserId: BigInt(telegramUserId) } },
    include: { user: true, chat: true }
  });
}

export async function executeTelegramActorModerationAction(input: {
  chatId: string;
  targetTelegramUserId: number;
  action: ModerationActionValue;
  reason?: string | null;
  muteDurationMinutes?: number | null;
  banDurationMinutes?: number | null;
  telegramActor: TelegramActor;
  suppressTargetNotification?: boolean;
}) {
  const reason = normalizeReason(input.reason);
  if (requiresReason(input.action) && !reason) throw new ModerationError("REASON_REQUIRED", "Укажите причину действия модерации.", 400);
  assertDurationMinutes(input.muteDurationMinutes, "INVALID_MUTE_DURATION", "Срок mute должен быть от 1 минуты до 7 дней.", MUTE_DURATION_MINUTES_MAX);
  assertDurationMinutes(input.banDurationMinutes, "INVALID_BAN_DURATION", "Срок бана должен быть от 1 минуты до 366 дней.", BAN_DURATION_MINUTES_MAX);

  const member = await loadMemberByTelegramUser(input.chatId, input.targetTelegramUserId);
  if (!member) throw new ModerationError("MEMBER_NOT_FOUND", "Участник не найден.", 404);
  assertLocalActionAllowed(input.action, member);

  const metadata = telegramActorMetadata(input.telegramActor);

  if (input.action === "WARNING") {
    return recordWarning({ membershipId: member.id, member, actingAdminId: null, source: "TELEGRAM", reason, metadata, notificationAdmin: input.telegramActor, suppressTargetNotification: input.suppressTargetNotification });
  }

  const durationMinutes = input.action === "MUTE" ? input.muteDurationMinutes : input.action === "BAN" ? input.banDurationMinutes : null;
  const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60_000) : null;

  return executeTelegramBackedAction({
    member,
    actingAdminId: null,
    source: "TELEGRAM",
    action: input.action,
    reason,
    expiresAt,
    auditAction: ACTION_AUDIT_LABELS[input.action],
    metadata: durationMinutes
      ? { ...metadata, ...(input.action === "MUTE" ? { muteDurationMinutes: durationMinutes } : { banDurationMinutes: durationMinutes }) }
      : metadata,
    notificationAdmin: input.telegramActor,
    suppressTargetNotification: input.suppressTargetNotification
  });
}

/**
 * /unwarn's shared core (mirrors recordWarning above, generic over
 * source/actingAdminId, called from both the Telegram path and Web Admin).
 * Purely local: unlike mute/ban there is no Telegram call to make. The latest
 * active WARNING entity is marked revoked and the member counter is rebuilt
 * from the remaining active records.
 */
async function recordWarningRevoke(input: {
  membershipId: string;
  actingAdminId: string | null;
  source: ActionSource;
  metadata?: Prisma.InputJsonObject;
  notificationAdmin?: TelegramActor;
  suppressTargetNotification?: boolean;
}) {
  const member = await loadMember(input.membershipId);
  if (!member) throw new ModerationError("MEMBER_NOT_FOUND", "Участник не найден.", 404);
  const revoked = await revokeWarningRecord({
    chatId: member.chatId,
    affectedUserId: member.userId,
    revokedByAdminId: input.actingAdminId,
    revocationReason: "Предупреждение снято администратором.",
    audit: {
      source: input.source,
      actingAdminId: input.actingAdminId,
      metadata: input.metadata
    }
  });
  if (revoked.outcome !== "revoked") {
    throw new ModerationError("NO_WARNINGS", "У участника нет предупреждений.", 409);
  }

  if (!input.suppressTargetNotification) await notifyModerationTarget({
    chatId: member.chatId,
    telegramChatId: member.chat.telegramChatId,
    telegramUserId: member.user.telegramUserId,
    chatTitle: member.chat.title,
    actionType: "UNWARN",
    reason: "Предупреждение снято администратором.",
    warns: String(revoked.remainingWarningCount),
    notificationSource: notificationSource(input.source),
    targetDisplayName: member.user.displayName,
    admin: input.notificationAdmin ? {
      telegramUserId: input.notificationAdmin.telegramUserId,
      displayName: input.notificationAdmin.displayName ?? input.notificationAdmin.username ?? "Администратор"
    } : undefined
  }).catch(() => undefined);

  if (input.source === "ADMIN") {
    await sendPublicModerationNotification({
      event: "UNWARN",
      telegramChatId: member.chat.telegramChatId,
      target: member.user.displayName ?? member.user.telegramUserId.toString(),
      targetTelegramUserId: member.user.telegramUserId,
      reason: "Предупреждение снято администратором.",
      warns: String(revoked.remainingWarningCount)
    }).catch(() => undefined);
  }

  return {
    warningCount: revoked.remainingWarningCount,
    warningActionId: revoked.warningActionId,
    chatId: member.chatId,
    affectedUserId: member.userId
  };
}

export async function executeTelegramActorWarningRevoke(input: {
  chatId: string;
  targetTelegramUserId: number;
  telegramActor: TelegramActor;
  suppressTargetNotification?: boolean;
}) {
  const member = await loadMemberByTelegramUser(input.chatId, input.targetTelegramUserId);
  if (!member) throw new ModerationError("MEMBER_NOT_FOUND", "Участник не найден.", 404);
  return recordWarningRevoke({
    membershipId: member.id,
    actingAdminId: null,
    source: "TELEGRAM",
    metadata: telegramActorMetadata(input.telegramActor),
    notificationAdmin: input.telegramActor,
    suppressTargetNotification: input.suppressTargetNotification
  });
}

export async function executeAdminWarningRevoke(input: {
  membershipId: string;
  actingAdminId: string;
}) {
  return recordWarningRevoke({
    membershipId: input.membershipId,
    actingAdminId: input.actingAdminId,
    source: "ADMIN"
  });
}

export async function executeAutomatedModerationAction(input: {
  membershipId: string;
  action: "MUTE" | "BAN";
  reason: string;
  escalationWarningCount: number;
  triggerRule: string;
  muteDurationMinutes?: number;
  banDurationMinutes?: number;
}) {
  const member = await loadMember(input.membershipId);
  if (!member) throw new ModerationError("MEMBER_NOT_FOUND", "Участник не найден.", 404);
  const durationMinutes = input.action === "MUTE" ? input.muteDurationMinutes : input.banDurationMinutes;
  const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60_000) : null;

  return executeTelegramBackedAction({
    member,
    actingAdminId: null,
    source: "SYSTEM",
    action: input.action,
    reason: normalizeReason(input.reason),
    expiresAt,
    auditAction: input.action === "MUTE" ? "AUTOMOD_AUTO_MUTE" : "AUTOMOD_AUTO_BAN",
    escalationWarningCount: input.escalationWarningCount,
    metadata: {
      automated: true,
      triggerRule: input.triggerRule,
      warningCount: input.escalationWarningCount,
      ...(input.muteDurationMinutes ? { muteDurationMinutes: input.muteDurationMinutes } : {})
    }
  });
}

export async function executeExpiredMuteRelease(input: {
  membershipId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const member = await loadMember(input.membershipId);
  if (!member) return { outcome: "skipped" as const, reason: "MEMBER_NOT_FOUND" as const };
  if (
    member.punishmentState !== "MUTED" ||
    !member.punishmentExpiresAt ||
    member.punishmentExpiresAt > now
  ) {
    return { outcome: "skipped" as const, reason: "NOT_EXPIRED" as const };
  }

  const result = await executeTelegramBackedAction({
    member,
    actingAdminId: null,
    source: "SYSTEM",
    action: "UNMUTE",
    reason: "Истёк срок временного mute.",
    auditAction: "MODERATION_EXPIRED_UNMUTE",
    metadata: {
      automaticExpiration: true,
      scheduledFor: member.punishmentExpiresAt.toISOString()
    }
  });
  return { outcome: "released" as const, result };
}

export async function executeExpiredBanRelease(input: {
  membershipId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const member = await loadMember(input.membershipId);
  if (!member) return { outcome: "skipped" as const, reason: "MEMBER_NOT_FOUND" as const };
  if (
    member.punishmentState !== "BANNED" ||
    !member.punishmentExpiresAt ||
    member.punishmentExpiresAt > now
  ) {
    return { outcome: "skipped" as const, reason: "NOT_EXPIRED" as const };
  }

  const result = await executeTelegramBackedAction({
    member,
    actingAdminId: null,
    source: "SYSTEM",
    action: "UNBAN",
    reason: "Истёк срок временной блокировки.",
    auditAction: "MODERATION_EXPIRED_UNBAN",
    metadata: {
      automaticExpiration: true,
      scheduledFor: member.punishmentExpiresAt.toISOString()
    }
  });
  return { outcome: "released" as const, result };
}

export async function executeSelfServiceUnmute(input: { membershipId: string }) {
  const member = await loadMember(input.membershipId);
  if (!member) throw new ModerationError("MEMBER_NOT_FOUND", "Участник не найден.", 404);
  if (member.punishmentState !== "MUTED") {
    throw new ModerationError("NOT_MUTED", "У участника нет активного mute.", 409);
  }

  return executeTelegramBackedAction({
    member,
    actingAdminId: null,
    source: "SYSTEM",
    action: "UNMUTE",
    reason: "Самостоятельная разблокировка пользователем.",
    auditAction: "SELF_UNMUTE"
  });
}
