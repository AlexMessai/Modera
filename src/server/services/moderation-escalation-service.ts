import { prisma } from "@/server/db/prisma";
import { notifyPunishmentAppealOption } from "@/server/services/appeal-notification-service";
import {
  resolveEffectiveModerationSettings,
  type ModerationSettingsValue
} from "@/server/services/global-moderation-service";
import {
  executeAutomatedModerationAction,
  isProtectedMemberStatus,
  ModerationError
} from "@/server/services/moderation-service";

type EscalationPolicy = Pick<
  ModerationSettingsValue,
  "muteAfterWarnings" | "muteDurationMinutes" | "banAfterWarnings"
>;

/** What the chat reply needs to know after an admin's manual /warn. */
export type ManualWarningEscalation = {
  activeWarningCount: number;
  warnsLimit: number;
  escalated: boolean;
  action?: "MUTE" | "BAN";
  muteDurationMinutes?: number;
};

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

/** Active-warning count + the mute threshold, for a chat reply after /unwarn. */
export async function describeWarningStanding(input: { chatId: string; affectedUserId: string }) {
  const resolved = await resolveEffectiveModerationSettings(input.chatId);
  const activeWarningCount = await countActiveWarnings({
    chatId: input.chatId,
    affectedUserId: input.affectedUserId,
    warningExpiryDays: resolved.settings.warningExpiryDays
  });
  return { activeWarningCount, warnsLimit: resolved.settings.muteAfterWarnings };
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

  return applyWarningEscalation({
    membershipId: warning.id,
    policy,
    reason,
    triggerRule: input.rule,
    warningCount: warning.warningCount,
    activeWarningCount: warning.activeWarningCount,
    escalationMarker: warning.escalationMarker
  });
}

/**
 * Escalation for a warning an admin issued by hand with /warn in the chat.
 * Runs the same thresholds as automod (one shared `warningCount` per member, so
 * one shared threshold), and reports the running count back for the chat reply.
 */
export async function escalateAfterManualWarning(input: {
  membershipId: string;
  chatId: string;
  affectedUserId: string;
  reason: string;
  warningCount: number;
}): Promise<ManualWarningEscalation> {
  const resolved = await resolveEffectiveModerationSettings(input.chatId);
  const policy = resolved.settings;
  const now = new Date();
  const cutoff = warningCutoff(now, policy.warningExpiryDays);
  const activeWarningCount = cutoff
    ? await prisma.moderationAction.count({
        where: {
          chatId: input.chatId,
          affectedUserId: input.affectedUserId,
          type: "WARNING",
          status: "SUCCEEDED",
          createdAt: { gte: cutoff }
        }
      })
    : input.warningCount;

  const idle: ManualWarningEscalation = {
    activeWarningCount,
    warnsLimit: policy.muteAfterWarnings,
    escalated: false
  };
  if (!policy.autoEscalationEnabled) return idle;

  const member = await prisma.chatMember.findUnique({
    where: { id: input.membershipId },
    select: {
      status: true,
      lastAutoEscalationWarningCount: true,
      user: { select: { isBot: true } }
    }
  });
  if (!member || member.user.isBot || isProtectedMemberStatus(member.status)) return idle;

  let escalationMarker = member.lastAutoEscalationWarningCount;
  if (cutoff) {
    const previousActiveCount = Math.max(0, activeWarningCount - 1);
    if (previousActiveCount < escalationMarker) {
      const reset = await prisma.chatMember.updateMany({
        where: { id: input.membershipId, lastAutoEscalationWarningCount: escalationMarker },
        data: { lastAutoEscalationWarningCount: 0 }
      });
      if (reset.count === 1) escalationMarker = 0;
    }
  }

  const escalation = await applyWarningEscalation({
    membershipId: input.membershipId,
    policy,
    reason: input.reason,
    triggerRule: "MANUAL_WARN",
    warningCount: input.warningCount,
    activeWarningCount,
    escalationMarker
  });

  return {
    activeWarningCount,
    warnsLimit: policy.muteAfterWarnings,
    escalated: escalation.escalated,
    action: escalation.escalated ? escalation.action : undefined,
    muteDurationMinutes: escalation.escalated ? escalation.muteDurationMinutes : undefined
  };
}

/**
 * Threshold check + escalation for a warning that has already been recorded.
 * Shared by automod violations and by an admin's manual /warn in the chat, so a
 * member's warning count means the same thing whoever issued the warning.
 */
export async function applyWarningEscalation(input: {
  membershipId: string;
  policy: EscalationPolicy;
  reason: string;
  triggerRule: string;
  warningCount: number;
  activeWarningCount: number;
  escalationMarker: number;
}) {
  const { policy } = input;
  let action: "MUTE" | "BAN" | null = null;
  let threshold = 0;
  if (
    input.activeWarningCount >= policy.banAfterWarnings &&
    input.escalationMarker < policy.banAfterWarnings
  ) {
    action = "BAN";
    threshold = policy.banAfterWarnings;
  } else if (
    input.activeWarningCount >= policy.muteAfterWarnings &&
    input.escalationMarker < policy.muteAfterWarnings
  ) {
    action = "MUTE";
    threshold = policy.muteAfterWarnings;
  }

  if (!action) {
    return {
      enabled: true,
      escalated: false,
      warningCount: input.warningCount,
      activeWarningCount: input.activeWarningCount
    } as const;
  }

  const previousMarker = input.escalationMarker;
  const claim = await prisma.chatMember.updateMany({
    where: {
      id: input.membershipId,
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
      warningCount: input.warningCount,
      activeWarningCount: input.activeWarningCount,
      attemptedAction: action,
      skippedConcurrentClaim: true
    } as const;
  }

  try {
    const result = await executeAutomatedModerationAction({
      membershipId: input.membershipId,
      action,
      reason: action === "MUTE"
        ? `${input.reason}. Достигнут порог ${policy.muteAfterWarnings} активных предупреждений.`
        : `${input.reason}. Достигнут порог ${policy.banAfterWarnings} активных предупреждений.`,
      escalationWarningCount: input.activeWarningCount,
      triggerRule: input.triggerRule,
      ...(action === "MUTE" ? { muteDurationMinutes: policy.muteDurationMinutes } : {})
    });
    return {
      enabled: true,
      escalated: true,
      warningCount: input.warningCount,
      activeWarningCount: input.activeWarningCount,
      action,
      muteDurationMinutes: action === "MUTE" ? policy.muteDurationMinutes : undefined,
      result
    } as const;
  } catch (error) {
    if (!(error instanceof ModerationError && error.code === "ACTION_RECONCILIATION_REQUIRED")) {
      await prisma.chatMember.updateMany({
        where: {
          id: input.membershipId,
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
      warningCount: input.warningCount,
      activeWarningCount: input.activeWarningCount,
      attemptedAction: action,
      error: message
    } as const;
  }
}