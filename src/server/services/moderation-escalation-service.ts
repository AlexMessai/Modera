import { prisma } from "@/server/db/prisma";
import { notifyPunishmentAppealOption } from "@/server/services/appeal-notification-service";
import {
  findTriggeredEscalationRule,
  nextEscalationThreshold,
  resolveEffectiveModerationSettings,
  type AutomodPunishmentAction,
  type ModerationSettingsValue
} from "@/server/services/global-moderation-service";
import {
  executeAutomatedModerationAction,
  isProtectedMemberStatus,
  ModerationError
} from "@/server/services/moderation-service";
import {
  countActiveWarningRecords,
  linkWarningToTriggeredPunishment
} from "@/server/services/warning-service";

type EscalationPolicy = Pick<ModerationSettingsValue, "escalationRules">;

/** What the chat reply needs to know after an admin's manual /warn. */
export type ManualWarningEscalation = {
  activeWarningCount: number;
  /** Lowest configured threshold across the rule chain — null if no rules are configured. */
  warnsLimit: number | null;
  escalated: boolean;
  action?: "MUTE" | "BAN";
  /** The threshold of the rule that actually fired (not necessarily `warnsLimit`, when multiple rules are configured). */
  threshold?: number;
  muteDurationMinutes?: number;
  /** Set when a threshold *was* crossed but the mute/ban itself failed (e.g. the bot lacks "restrict members") — without this, the admin sees a plain warning confirmation with no sign that a punishment was attempted and silently failed. */
  attemptedAction?: "MUTE" | "BAN";
  error?: string;
};

/**
 * Explicit on purpose: applyWarningEscalation/recordAutomodViolationAndEscalate
 * each return one of several differently-shaped branches (disabled, skipped,
 * below-threshold, concurrent-claim-lost, escalated, escalation-failed).
 * Leaving the return type inferred let TypeScript widen it to only the fields
 * shared by every branch once escalation lived in its own function reached via
 * `return otherFn()` — callers lost access to fields that clearly exist on the
 * branch they're looking at. Every field but `enabled`/`escalated` is optional
 * here rather than spelling out each branch as a discriminated union, since
 * nothing in this module needs to narrow on it — only read whichever fields a
 * given branch happens to set.
 */
export type WarningEscalationResult = {
  enabled: boolean;
  escalated: boolean;
  skipped?: boolean;
  warningCount?: number;
  activeWarningCount?: number;
  attemptedAction?: "MUTE" | "BAN";
  skippedConcurrentClaim?: boolean;
  action?: "MUTE" | "BAN";
  /** The threshold of the rule that fired. */
  threshold?: number;
  muteDurationMinutes?: number;
  result?: Awaited<ReturnType<typeof executeAutomatedModerationAction>>;
  error?: string;
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

/** Active-warning count + the next unreached mute/ban threshold, for a chat reply after /unwarn. */
export async function describeWarningStanding(input: { chatId: string; affectedUserId: string }) {
  const [resolved, member] = await Promise.all([
    resolveEffectiveModerationSettings(input.chatId),
    prisma.chatMember.findFirst({
      where: { chatId: input.chatId, userId: input.affectedUserId },
      select: { lastAutoEscalationWarningCount: true, warningsResetAt: true }
    })
  ]);
  const activeWarningCount = await countActiveWarnings({
    chatId: input.chatId,
    affectedUserId: input.affectedUserId,
    warningExpiryDays: resolved.settings.warningExpiryDays,
    warningsResetAt: member?.warningsResetAt ?? null
  });
  return {
    activeWarningCount,
    warnsLimit: nextEscalationThreshold(resolved.settings.escalationRules, member?.lastAutoEscalationWarningCount ?? 0)
  };
}

/** Backs `/warns` — active-count + a short recent history for one member in one chat. */
export async function listWarningsForMember(input: { chatId: string; telegramUserId: number }) {
  const member = await prisma.chatMember.findFirst({
    where: { chatId: input.chatId, user: { telegramUserId: BigInt(input.telegramUserId) } },
    select: { userId: true, warningCount: true, lastAutoEscalationWarningCount: true, warningsResetAt: true }
  });
  if (!member) return null;

  const resolved = await resolveEffectiveModerationSettings(input.chatId);
  const [activeWarningCount, recent] = await Promise.all([
    countActiveWarnings({
      chatId: input.chatId,
      affectedUserId: member.userId,
      warningExpiryDays: resolved.settings.warningExpiryDays,
      warningsResetAt: member.warningsResetAt
    }),
    prisma.moderationAction.findMany({
      where: { chatId: input.chatId, affectedUserId: member.userId, type: "WARNING" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { reason: true, createdAt: true, source: true }
    })
  ]);

  return {
    activeWarningCount,
    warnsLimit: nextEscalationThreshold(resolved.settings.escalationRules, member.lastAutoEscalationWarningCount),
    totalWarningCount: member.warningCount,
    recent
  };
}

export async function countActiveWarnings(input: {
  chatId: string;
  affectedUserId: string;
  warningExpiryDays: number;
  warningsResetAt?: Date | null;
  now?: Date;
}) {
  return countActiveWarningRecords(input);
}

export async function recordAutomodViolationAndEscalate(input: {
  chatId: string;
  telegramUserId: number;
  rule: string;
  telegramMessageId: string;
  recordWarningWhenEscalationDisabled?: boolean;
}): Promise<WarningEscalationResult> {
  const resolved = await resolveEffectiveModerationSettings(input.chatId);
  const policy = resolved.settings;
  if (!policy.autoEscalationEnabled && !input.recordWarningWhenEscalationDisabled) {
    return { enabled: false, escalated: false } as const;
  }

  const member = await prisma.chatMember.findFirst({
    where: { chatId: input.chatId, user: { telegramUserId: BigInt(input.telegramUserId) } },
    include: {
      user: { select: { isBot: true, telegramUserId: true, displayName: true } },
      chat: { select: { title: true, telegramChatId: true } }
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
  const expiryCutoff = warningCutoff(now, policy.warningExpiryDays);
  const cutoff = expiryCutoff && member.warningsResetAt
    ? (expiryCutoff > member.warningsResetAt ? expiryCutoff : member.warningsResetAt)
    : expiryCutoff ?? member.warningsResetAt ?? null;

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
            revokedAt: null,
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
    telegramChatId: member.chat.telegramChatId,
    userId: member.userId,
    telegramUserId: member.user.telegramUserId,
    chatTitle: member.chat.title,
    actionType: "WARNING",
    reason,
    notificationSource: "AUTOMATED",
    targetDisplayName: member.user.displayName
  }).catch(() => undefined);

  if (!policy.autoEscalationEnabled) {
    return {
      enabled: false,
      escalated: false,
      warningCount: warning.warningCount,
      activeWarningCount: warning.activeWarningCount
    } as const;
  }

  return applyWarningEscalation({
    membershipId: warning.id,
    chatId: input.chatId,
    affectedUserId: member.userId,
    policy,
    reason,
    triggerRule: input.rule,
    warningCount: warning.warningCount,
    activeWarningCount: warning.activeWarningCount,
    escalationMarker: warning.escalationMarker,
    warningActionId: warning.moderationActionId
  });
}

/** Applies the explicit outcome selected in an Automod rule modal. */
export async function applyAutomodRulePunishment(input: {
  chatId: string;
  telegramUserId: number;
  rule: string;
  telegramMessageId: string;
  action: AutomodPunishmentAction;
  muteDurationMinutes: number;
}): Promise<WarningEscalationResult> {
  if (input.action === "WARN") {
    return recordAutomodViolationAndEscalate({
      chatId: input.chatId,
      telegramUserId: input.telegramUserId,
      rule: input.rule,
      telegramMessageId: input.telegramMessageId,
      recordWarningWhenEscalationDisabled: true
    });
  }

  const member = await prisma.chatMember.findFirst({
    where: { chatId: input.chatId, user: { telegramUserId: BigInt(input.telegramUserId) } },
    select: {
      id: true,
      userId: true,
      status: true,
      warningCount: true,
      user: { select: { isBot: true } }
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

  try {
    const result = await executeAutomatedModerationAction({
      membershipId: member.id,
      action: "MUTE",
      reason: `Автомодерация: ${RULE_LABELS[input.rule] ?? "нарушение правила"}`,
      escalationWarningCount: member.warningCount,
      triggerRule: input.rule,
      muteDurationMinutes: input.muteDurationMinutes
    });
    return {
      enabled: true,
      escalated: true,
      warningCount: member.warningCount,
      activeWarningCount: member.warningCount,
      action: "MUTE",
      muteDurationMinutes: input.muteDurationMinutes,
      result
    } as const;
  } catch (error) {
    return {
      enabled: true,
      escalated: false,
      warningCount: member.warningCount,
      activeWarningCount: member.warningCount,
      attemptedAction: "MUTE",
      error: error instanceof ModerationError ? error.message : "Не удалось применить автоматическое наказание."
    } as const;
  }
}

/**
 * Escalation for a warning an admin issued by hand with /warn in the chat.
 * Looks the member up itself (by chat + Telegram id) rather than taking a
 * membershipId/warningCount from the caller, so it stays decoupled from
 * whatever executeTelegramActorModerationAction happens to return for
 * WARNING vs. its other actions. Runs the same thresholds as automod (one
 * shared `warningCount` per member, so one shared threshold), and reports the
 * running count back for the chat reply.
 */
export async function escalateAfterManualWarning(input: {
  chatId: string;
  targetTelegramUserId: number;
  reason: string;
  warningActionId?: string;
}): Promise<ManualWarningEscalation> {
  const resolved = await resolveEffectiveModerationSettings(input.chatId);
  const policy = resolved.settings;

  const member = await prisma.chatMember.findFirst({
    where: { chatId: input.chatId, user: { telegramUserId: BigInt(input.targetTelegramUserId) } },
    select: {
      id: true,
      status: true,
      warningCount: true,
      lastAutoEscalationWarningCount: true,
      warningsResetAt: true,
      user: { select: { id: true, isBot: true } }
    }
  });
  if (!member) return { activeWarningCount: 0, warnsLimit: nextEscalationThreshold(policy.escalationRules, 0), escalated: false };

  const now = new Date();
  const cutoff = warningCutoff(now, policy.warningExpiryDays);
  const activeWarningCount = await countActiveWarnings({
    chatId: input.chatId,
    affectedUserId: member.user.id,
    warningExpiryDays: policy.warningExpiryDays,
    warningsResetAt: member.warningsResetAt,
    now
  });

  const idle: ManualWarningEscalation = {
    activeWarningCount,
    warnsLimit: nextEscalationThreshold(policy.escalationRules, member.lastAutoEscalationWarningCount),
    escalated: false
  };
  if (!policy.autoEscalationEnabled || member.user.isBot || isProtectedMemberStatus(member.status)) return idle;

  let escalationMarker = member.lastAutoEscalationWarningCount;
  if (cutoff) {
    const previousActiveCount = Math.max(0, activeWarningCount - 1);
    if (previousActiveCount < escalationMarker) {
      const reset = await prisma.chatMember.updateMany({
        where: { id: member.id, lastAutoEscalationWarningCount: escalationMarker },
        data: { lastAutoEscalationWarningCount: 0 }
      });
      if (reset.count === 1) escalationMarker = 0;
    }
  }

  const escalation = await applyWarningEscalation({
    membershipId: member.id,
    chatId: input.chatId,
    affectedUserId: member.user.id,
    policy,
    reason: input.reason,
    triggerRule: "MANUAL_WARN",
    warningCount: member.warningCount,
    activeWarningCount,
    escalationMarker,
    warningActionId: input.warningActionId
  });

  return {
    activeWarningCount,
    warnsLimit: nextEscalationThreshold(policy.escalationRules, escalation.escalated ? (escalation.threshold ?? escalationMarker) : escalationMarker),
    escalated: escalation.escalated,
    action: escalation.escalated ? escalation.action : undefined,
    threshold: escalation.escalated ? escalation.threshold : undefined,
    muteDurationMinutes: escalation.escalated ? escalation.muteDurationMinutes : undefined,
    // Forwarded even though escalation.escalated is false here -- this is
    // exactly the "threshold crossed but the punishment itself failed" case
    // the caller needs to tell apart from "no threshold crossed yet".
    attemptedAction: escalation.attemptedAction,
    error: escalation.error
  };
}

/**
 * Threshold check + escalation for a warning that has already been recorded.
 * Shared by automod violations and by an admin's manual /warn in the chat, so a
 * member's warning count means the same thing whoever issued the warning.
 */
export async function applyWarningEscalation(input: {
  membershipId: string;
  chatId: string;
  affectedUserId: string;
  policy: EscalationPolicy;
  reason: string;
  triggerRule: string;
  warningCount: number;
  activeWarningCount: number;
  escalationMarker: number;
  warningActionId?: string;
}): Promise<WarningEscalationResult> {
  const { policy } = input;
  const triggered = findTriggeredEscalationRule(policy.escalationRules, input.activeWarningCount, input.escalationMarker);

  if (!triggered) {
    // Diagnostic trail for "warnings pile up but nothing ever fires" support
    // questions -- only logged when the count *should* have crossed a rule
    // by itself (so this stays quiet for the common "still below every
    // threshold" case) but didn't fire, meaning either no rules are
    // configured or the escalation marker is already at/above the threshold
    // that would otherwise match (e.g. a prior attempt claimed it and was
    // never rolled back cleanly).
    const suspicious = policy.escalationRules.length === 0 ||
      policy.escalationRules.some((rule) => input.activeWarningCount >= rule.thresholdWarnings);
    if (suspicious) {
      await prisma.auditLog.create({
        data: {
          chatId: input.chatId,
          affectedUserId: input.affectedUserId,
          source: "SYSTEM",
          action: "AUTOMOD_ESCALATION_NOT_TRIGGERED",
          reason: policy.escalationRules.length === 0
            ? "Нет настроенных правил порога."
            : "Порог достигнут по счётчику, но уже отмечен как обработанный (escalationMarker).",
          metadata: {
            triggerRule: input.triggerRule,
            activeWarningCount: input.activeWarningCount,
            escalationMarker: input.escalationMarker,
            rules: policy.escalationRules
          }
        }
      }).catch(() => undefined);
    }

    return {
      enabled: true,
      escalated: false,
      warningCount: input.warningCount,
      activeWarningCount: input.activeWarningCount
    } as const;
  }

  const action = triggered.action;
  const threshold = triggered.thresholdWarnings;

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
      reason: `${input.reason}. Достигнут порог ${threshold} активных предупреждений.`,
      escalationWarningCount: input.activeWarningCount,
      triggerRule: input.triggerRule,
      ...(action === "MUTE" ? { muteDurationMinutes: triggered.durationMinutes ?? undefined } : {}),
      ...(action === "BAN" ? { banDurationMinutes: triggered.durationMinutes ?? undefined } : {})
    });
    if (input.warningActionId) {
      await linkWarningToTriggeredPunishment(input.warningActionId, result.id);
    }
    if (triggered.resetWarningsOnTrigger) {
      // Deliberately doesn't touch ChatMember.warningCount or any
      // ModerationAction row -- /warns, /info, and the member profile keep
      // showing the full lifetime history. Only the escalation-relevant
      // window (countActiveWarningRecords) and the marker restart, so the
      // member's next warning re-enters the chain at its lowest level.
      await prisma.chatMember.update({
        where: { id: input.membershipId },
        data: { lastAutoEscalationWarningCount: 0, warningsResetAt: new Date() }
      }).catch(() => undefined);
    }
    return {
      enabled: true,
      escalated: true,
      warningCount: input.warningCount,
      activeWarningCount: input.activeWarningCount,
      action,
      threshold,
      muteDurationMinutes: action === "MUTE" ? (triggered.durationMinutes ?? undefined) : undefined,
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

    // No separate AuditLog write here -- executeTelegramBackedAction's own
    // failAction() already records an AUTOMOD_ESCALATION_FAILED entry for
    // this same failure (source: "SYSTEM"), since executeAutomatedModerationAction
    // routes through it. A second write here would just duplicate the
    // Журнал entry. What *was* missing is surfacing attemptedAction/error to
    // the caller (see ManualWarningEscalation below) -- previously
    // escalateAfterManualWarning discarded them, so the admin's chat reply
    // had no sign the mute/ban was attempted and failed, and the next
    // /warn silently repeated the same failing attempt.
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
