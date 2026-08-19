import { prisma } from "@/server/db/prisma";
import { notifyPunishmentAppealOption } from "@/server/services/appeal-notification-service";
import { resolveEffectiveModerationSettings } from "@/server/services/global-moderation-service";
import {
  executeAutomatedModerationAction,
  isProtectedMemberStatus,
  ModerationError
} from "@/server/services/moderation-service";

const RULE_LABELS: Record<string, string> = {
  LINK: "запрещённая ссылка",
  TERM: "запрещённое слово или фраза",
  MEDIA: "запрещённый тип контента",
  MENTIONS: "массовые упоминания",
  DUPLICATE: "повторяющееся сообщение",
  SPAM: "флуд"
};

export function warningCutoff(now: Date, warningExpiryDays: number) {
  if (warningExpiryDays <= 0) return null;
  return new Date(now.getTime() - warningExpiryDays * 24 * 60 * 60 * 1000);
}

export async function countActiveWarnings(input: {
  chatId: string;
  affectedUserId: string;
  warningExpiryDays: number;
  now?: Date;
}) {
  if (input.warningExpiryDays <= 0) {
    const member = await prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: input.chatId,
          userId: input.affectedUserId
        }
      },
      select: { warningCount: true }
    });
    return member?.warningCount ?? 0;
  }

  const cutoff = warningCutoff(input.now ?? new Date(), input.warningExpiryDays);
  return prisma.moderationAction.count({
    where: {
      chatId: input.chatId,
      affectedUserId: input.affectedUserId,
      type: "WARNING",
      status: "SUCCEEDED",
      createdAt: cutoff ? { gte: cutoff } : undefined
    }
  });
}

export async function recordAutomodViolationAndEscalate(input: {
  chatId: string;
  telegramUserId: number;
  rule: string;
  telegramMessageId: string;
}) {
  const resolved = await resolveEffectiveModerationSettings(input.chatId);
  const policy = resolved.settings;
  if (!policy.autoEscalationEnabled) return { enabled: false, escalated: false } as const;

  const member = await prisma.chatMember.findFirst({
    where: { chatId: input.chatId, user: { telegramUserId: BigInt(input.telegramUserId) } },
    include: {
      user: { select: { isBot: true, telegramUserId: true } },
      chat: { select: { title: true } }
    }
  });
  if (!member || member.user.isBot || isProtectedMemberStatus(member.status)) {
    if (member && isProtectedMemberStatus(member.status)) {
      await prisma.auditLog.create({
        data: {
          chatId: input.chatId,
          affectedUserId: member.userId,
          source: "SYSTEM",
          action: "AUTOMOD_ESCALATION_SKIPPED_PROTECTED",
          reason: "Автоматическое наказание не применяется к владельцу или администратору Telegram.",
          metadata: { rule: input.rule, telegramMessageId: input.telegramMessageId }
        }
      });
    }
    return { enabled: true, escalated: false, skipped: true } as const;
  }

  const reason = `Автомодерация: ${RULE_LABELS[input.rule] ?? "нарушение правила"}`;
  const now = new Date();
  const cutoff = warningCutoff(now, policy.warningExpiryDays);

  const warning = await prisma.$transaction(async (tx) => {
    const updated = await tx.chatMember.update({
      where: { id: member.id },
      data: { warningCount: { increment: 1 } }
    });

    const action = await tx.moderationAction.create({
      data: {
        chatId: input.chatId,
        affectedUserId: member.userId,
        actingAdminId: null,
        source: "SYSTEM",
        type: "WARNING",
        status: "SUCCEEDED",
        reason,
        completedAt: now,
        metadata: {
          automated: true,
          triggerRule: input.rule,
          telegramMessageId: input.telegramMessageId,
          policySource: resolved.source,
          warningCount: updated.warningCount,
          warningExpiryDays: policy.warningExpiryDays
        }
      }
    });

    const activeWarningCount = cutoff
      ? await tx.moderationAction.count({
          where: {
            chatId: input.chatId,
            affectedUserId: member.userId,
            type: "WARNING",
            status: "SUCCEEDED",
            createdAt: { gte: cutoff }
          }
        })
      : updated.warningCount;

    let escalationMarker = updated.lastAutoEscalationWarningCount;
    if (cutoff) {
      const previousActiveCount = Math.max(0, activeWarningCount - 1);
      if (previousActiveCount < escalationMarker) {
        const reset = await tx.chatMember.updateMany({
          where: {
            id: member.id,
            lastAutoEscalationWarningCount: escalationMarker
          },
          data: { lastAutoEscalationWarningCount: 0 }
        });
        if (reset.count === 1) escalationMarker = 0;
      }
    }

    await tx.moderationAction.update({
      where: { id: action.id },
      data: {
        metadata: {
          automated: true,
          triggerRule: input.rule,
          telegramMessageId: input.telegramMessageId,
          policySource: resolved.source,
          warningCount: updated.warningCount,
          activeWarningCount,
          warningExpiryDays: policy.warningExpiryDays,
          warningCutoff: cutoff?.toISOString() ?? null
        }
      }
    });

    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: member.userId,
        source: "SYSTEM",
        action: "AUTOMOD_WARNING",
        reason,
        metadata: {
          moderationActionId: action.id,
          triggerRule: input.rule,
          telegramMessageId: input.telegramMessageId,
          warningCount: updated.warningCount,
          activeWarningCount,
          warningExpiryDays: policy.warningExpiryDays,
          warningCutoff: cutoff?.toISOString() ?? null,
          policySource: resolved.source
        }
      }
    });

    return {
      ...updated,
      activeWarningCount,
      escalationMarker,
      moderationActionId: action.id
    };
  });

  await notifyPunishmentAppealOption({
    moderationActionId: warning.moderationActionId,
    chatId: input.chatId,
    userId: member.userId,
    telegramUserId: member.user.telegramUserId,
    chatTitle: member.chat.title,
    actionType: "WARNING",
    reason
  }).catch(() => undefined);

  let action: "MUTE" | "BAN" | null = null;
  let threshold = 0;
  if (
    warning.activeWarningCount >= policy.banAfterWarnings &&
    warning.escalationMarker < policy.banAfterWarnings
  ) {
    action = "BAN";
    threshold = policy.banAfterWarnings;
  } else if (
    warning.activeWarningCount >= policy.muteAfterWarnings &&
    warning.escalationMarker < policy.muteAfterWarnings
  ) {
    action = "MUTE";
    threshold = policy.muteAfterWarnings;
  }

  if (!action) {
    return {
      enabled: true,
      escalated: false,
      warningCount: warning.warningCount,
      activeWarningCount: warning.activeWarningCount
    } as const;
  }

  const previousMarker = warning.escalationMarker;
  const claim = await prisma.chatMember.updateMany({
    where: {
      id: warning.id,
      lastAutoEscalationWarningCount: previousMarker
    },
    data: {
      lastAutoEscalationWarningCount: threshold
    }
  });

  if (claim.count === 0) {
    return {
      enabled: true,
      escalated: false,
      warningCount: warning.warningCount,
      activeWarningCount: warning.activeWarningCount,
      attemptedAction: action,
      skippedConcurrentClaim: true
    } as const;
  }

  try {
    const result = await executeAutomatedModerationAction({
      membershipId: warning.id,
      action,
      reason: action === "MUTE"
        ? `${reason}. Достигнут порог ${policy.muteAfterWarnings} активных предупреждений.`
        : `${reason}. Достигнут порог ${policy.banAfterWarnings} активных предупреждений.`,
      escalationWarningCount: warning.activeWarningCount,
      triggerRule: input.rule,
      ...(action === "MUTE" ? { muteDurationMinutes: policy.muteDurationMinutes } : {})
    });
    return {
      enabled: true,
      escalated: true,
      warningCount: warning.warningCount,
      activeWarningCount: warning.activeWarningCount,
      action,
      result
    } as const;
  } catch (error) {
    if (!(error instanceof ModerationError && error.code === "ACTION_RECONCILIATION_REQUIRED")) {
      await prisma.chatMember.updateMany({
        where: {
          id: warning.id,
          lastAutoEscalationWarningCount: threshold
        },
        data: {
          lastAutoEscalationWarningCount: previousMarker
        }
      }).catch(() => undefined);
    }

    const message = error instanceof ModerationError
      ? error.message
      : "Не удалось применить автоматическое наказание.";
    return {
      enabled: true,
      escalated: false,
      warningCount: warning.warningCount,
      activeWarningCount: warning.activeWarningCount,
      attemptedAction: action,
      error: message
    } as const;
  }
}