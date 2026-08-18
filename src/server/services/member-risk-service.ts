import { prisma } from "@/server/db/prisma";

export type MemberRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type MemberRiskReason = {
  code: string;
  label: string;
  detail: string;
  points: number;
};

export type MemberRiskResult = {
  score: number;
  level: MemberRiskLevel;
  reasons: MemberRiskReason[];
  computedAt: Date;
};

type MemberRiskInput = {
  now: Date;
  observedAt: Date;
  isBot: boolean;
  isTrusted: boolean;
  activeWarningCount: number;
  automodViolationCount: number;
  recentPunishmentCount: number;
  joinedDuringRaid: boolean;
};

const AUTOMOD_RISK_ACTIONS = [
  "AUTOMOD_LINK_DELETED",
  "AUTOMOD_TERM_DELETED",
  "AUTOMOD_MEDIA_DELETED",
  "AUTOMOD_MENTIONS_DELETED",
  "AUTOMOD_DUPLICATE_DELETED",
  "AUTOMOD_SPAM_DELETED"
] as const;

function riskLevel(score: number): MemberRiskLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

export function calculateMemberRisk(input: MemberRiskInput): MemberRiskResult {
  if (input.isBot) {
    return { score: 0, level: "LOW", reasons: [], computedAt: input.now };
  }

  if (input.isTrusted) {
    return {
      score: 0,
      level: "LOW",
      reasons: [{
        code: "TRUSTED_MEMBER",
        label: "Доверенный участник",
        detail: "Автоматические сигналы риска для этого чата отключены администратором.",
        points: 0
      }],
      computedAt: input.now
    };
  }

  const reasons: MemberRiskReason[] = [];
  const ageMs = Math.max(0, input.now.getTime() - input.observedAt.getTime());
  const dayMs = 24 * 60 * 60 * 1000;

  if (ageMs <= dayMs) {
    reasons.push({ code: "NEW_MEMBER_24H", label: "Новый участник", detail: "Впервые замечен менее 24 часов назад.", points: 12 });
  } else if (ageMs <= 7 * dayMs) {
    reasons.push({ code: "NEW_MEMBER_7D", label: "Недавний участник", detail: "Впервые замечен менее 7 дней назад.", points: 6 });
  }

  if (input.joinedDuringRaid) {
    reasons.push({ code: "JOINED_DURING_RAID", label: "Вступил во время рейда", detail: "Первое появление совпало с активным Anti-Raid инцидентом.", points: 30 });
  }

  if (input.activeWarningCount > 0) {
    const points = Math.min(30, input.activeWarningCount * 10);
    reasons.push({ code: "ACTIVE_WARNINGS", label: "Активные предупреждения", detail: `${input.activeWarningCount} предупреждений сейчас влияют на эскалацию.`, points });
  }

  if (input.automodViolationCount > 0) {
    const points = Math.min(30, input.automodViolationCount * 6);
    reasons.push({ code: "AUTOMOD_VIOLATIONS", label: "Нарушения автомодерации", detail: `${input.automodViolationCount} срабатываний за последние 30 дней.`, points });
  }

  if (input.recentPunishmentCount > 0) {
    const points = Math.min(24, input.recentPunishmentCount * 12);
    reasons.push({ code: "RECENT_PUNISHMENTS", label: "Недавние наказания", detail: `${input.recentPunishmentCount} выполненных mute или ban за последние 30 дней.`, points });
  }

  const score = Math.min(100, reasons.reduce((total, reason) => total + reason.points, 0));
  return { score, level: riskLevel(score), reasons, computedAt: input.now };
}

export async function getMemberRisk(
  membershipId: string,
  activeWarningCount: number,
  now = new Date()
): Promise<MemberRiskResult | null> {
  const membership = await prisma.chatMember.findUnique({
    where: { id: membershipId },
    select: {
      chatId: true,
      userId: true,
      internalRole: true,
      joinedAt: true,
      firstSeenAt: true,
      user: { select: { isBot: true } }
    }
  });
  if (!membership) return null;

  const observedAt = membership.joinedAt ?? membership.firstSeenAt;
  if (membership.user.isBot || membership.internalRole === "TRUSTED") {
    return calculateMemberRisk({
      now,
      observedAt,
      isBot: membership.user.isBot,
      isTrusted: membership.internalRole === "TRUSTED",
      activeWarningCount,
      automodViolationCount: 0,
      recentPunishmentCount: 0,
      joinedDuringRaid: false
    });
  }

  const activityFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [automodViolationCount, recentPunishmentCount, raidIncident] = await Promise.all([
    prisma.auditLog.count({
      where: {
        chatId: membership.chatId,
        affectedUserId: membership.userId,
        action: { in: [...AUTOMOD_RISK_ACTIONS] },
        createdAt: { gte: activityFrom, lte: now }
      }
    }),
    prisma.moderationAction.count({
      where: {
        chatId: membership.chatId,
        affectedUserId: membership.userId,
        type: { in: ["MUTE", "BAN"] },
        status: "SUCCEEDED",
        createdAt: { gte: activityFrom, lte: now }
      }
    }),
    prisma.raidIncident.findFirst({
      where: {
        chatId: membership.chatId,
        startedAt: { lte: observedAt },
        activeUntil: { gte: observedAt }
      },
      select: { id: true }
    })
  ]);

  return calculateMemberRisk({
    now,
    observedAt,
    isBot: false,
    isTrusted: false,
    activeWarningCount,
    automodViolationCount,
    recentPunishmentCount,
    joinedDuringRaid: Boolean(raidIncident)
  });
}
