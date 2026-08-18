import { prisma } from "@/server/db/prisma";
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

export async function recordAutomodViolationAndEscalate(input: {
  chatId: string;
  userId: string;
  rule: string;
  telegramMessageId: string;
}) {
  const resolved = await resolveEffectiveModerationSettings(input.chatId);
  const policy = resolved.settings;

  if (!policy.autoEscalationEnabled) {
    return { enabled: false, escalated: false } as const;
  }

  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId: input.chatId, userId: input.userId } },
    include: { user: { select: { isBot: true } } }
  });
  if (!member || member.user.isBot || isProtectedMemberStatus(member.status)) {
    if (member && isProtectedMemberStatus(member.status)) {
      await prisma.auditLog.create({
        data: {
          chatId: input.chatId,
          affectedUserId: input.userId,
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
  const warning = await prisma.$transaction(async (tx) => {
    const updated = await tx.chatMember.update({
      where: { id: member.id },
      data: { warningCount: { increment: 1 } }
    });
    const action = await tx.moderationAction.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.userId,
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
          warningCount: updated.warningCount
        }
      }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.userId,
        source: "SYSTEM",
        action: "AUTOMOD_WARNING",
        reason,
        metadata: {
          moderationActionId: action.id,
          triggerRule: input.rule,
          telegramMessageId: input.telegramMessageId,
          warningCount: updated.warningCount,
          policySource: resolved.source
        }
      }
    });
    return updated;
  });

  let action: "MUTE" | "BAN" | null = null;
  if (
    warning.warningCount >= policy.banAfterWarnings &&
    warning.lastAutoEscalationWarningCount < policy.banAfterWarnings
  ) {
    action = "BAN";
  } else if (
    warning.warningCount >= policy.muteAfterWarnings &&
    warning.lastAutoEscalationWarningCount < policy.muteAfterWarnings
  ) {
    action = "MUTE";
  }

  if (!action) {
    return { enabled: true, escalated: false, warningCount: warning.warningCount } as const;
  }

  try {
    const result = await executeAutomatedModerationAction({
      membershipId: warning.id,
      action,
      reason: action === "MUTE"
        ? `${reason}. Достигнут порог ${policy.muteAfterWarnings} предупреждений.`
        : `${reason}. Достигнут порог ${policy.banAfterWarnings} предупреждений.`,
      escalationWarningCount: warning.warningCount,
      triggerRule: input.rule,
      ...(action === "MUTE" ? { muteDurationMinutes: policy.muteDurationMinutes } : {})
    });
    return {
      enabled: true,
      escalated: true,
      warningCount: warning.warningCount,
      action,
      result
    } as const;
  } catch (error) {
    const message = error instanceof ModerationError ? error.message : "Не удалось применить автоматическое наказание.";
    return {
      enabled: true,
      escalated: false,
      warningCount: warning.warningCount,
      attemptedAction: action,
      error: message
    } as const;
  }
}