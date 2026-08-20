import { prisma } from "@/server/db/prisma";
import { buildTrendSlots, periodMilliseconds, type DashboardPeriod } from "@/server/services/trend-utils";

const AUTOMOD_RULE_ACTIONS = [
  "AUTOMOD_LINK_DELETED",
  "AUTOMOD_TERM_DELETED",
  "AUTOMOD_MEDIA_DELETED",
  "AUTOMOD_MENTIONS_DELETED",
  "AUTOMOD_DUPLICATE_DELETED",
  "AUTOMOD_SPAM_DELETED"
] as const;

const AUTOMOD_RULE_LABELS: Record<(typeof AUTOMOD_RULE_ACTIONS)[number], string> = {
  AUTOMOD_LINK_DELETED: "Ссылки",
  AUTOMOD_TERM_DELETED: "Запрещённые слова",
  AUTOMOD_MEDIA_DELETED: "Медиа",
  AUTOMOD_MENTIONS_DELETED: "Упоминания",
  AUTOMOD_DUPLICATE_DELETED: "Повторы",
  AUTOMOD_SPAM_DELETED: "Флуд"
};

type TrendRow = { bucket: string; count: number };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadMessageTrend(chatId: string, period: DashboardPeriod, from: Date) {
  if (period === "24H") {
    return prisma.$queryRaw<TrendRow[]>`
      SELECT
        to_char(date_trunc('hour', "telegramDate" AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS bucket,
        COUNT(*)::int AS count
      FROM "Message"
      WHERE "chatId" = ${chatId}::uuid AND "telegramDate" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }
  return prisma.$queryRaw<TrendRow[]>`
    SELECT
      (date_trunc('day', "telegramDate" AT TIME ZONE 'UTC'))::date::text AS bucket,
      COUNT(*)::int AS count
    FROM "Message"
    WHERE "chatId" = ${chatId}::uuid AND "telegramDate" >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;
}

async function loadJoinTrend(chatId: string, period: DashboardPeriod, from: Date) {
  if (period === "24H") {
    return prisma.$queryRaw<TrendRow[]>`
      SELECT
        to_char(date_trunc('hour', "joinedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS bucket,
        COUNT(*)::int AS count
      FROM "ChatMember"
      WHERE "chatId" = ${chatId}::uuid AND "joinedAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }
  return prisma.$queryRaw<TrendRow[]>`
    SELECT
      (date_trunc('day', "joinedAt" AT TIME ZONE 'UTC'))::date::text AS bucket,
      COUNT(*)::int AS count
    FROM "ChatMember"
    WHERE "chatId" = ${chatId}::uuid AND "joinedAt" >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;
}

async function loadModerationTrend(chatId: string, period: DashboardPeriod, from: Date) {
  if (period === "24H") {
    return prisma.$queryRaw<TrendRow[]>`
      SELECT
        to_char(date_trunc('hour', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS bucket,
        COUNT(*)::int AS count
      FROM "ModerationAction"
      WHERE "chatId" = ${chatId}::uuid AND "createdAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }
  return prisma.$queryRaw<TrendRow[]>`
    SELECT
      (date_trunc('day', "createdAt" AT TIME ZONE 'UTC'))::date::text AS bucket,
      COUNT(*)::int AS count
    FROM "ModerationAction"
    WHERE "chatId" = ${chatId}::uuid AND "createdAt" >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;
}

export async function getChatStatistics(chatId: string, period: DashboardPeriod) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { id: true } });
  if (!chat) return null;

  const now = new Date();
  const from = new Date(now.getTime() - periodMilliseconds(period));

  const [messageTrend, joinTrend, moderationTrend, topMembersRows, ruleBreakdownRows] = await Promise.all([
    loadMessageTrend(chatId, period, from),
    loadJoinTrend(chatId, period, from),
    loadModerationTrend(chatId, period, from),
    prisma.$queryRaw<Array<{ membershipId: string; displayName: string; username: string | null; messages: number }>>`
      SELECT cm."id" AS "membershipId", u."displayName", u."username", COUNT(m."id")::int AS messages
      FROM "Message" m
      JOIN "TelegramUser" u ON u."id" = m."senderUserId"
      JOIN "ChatMember" cm ON cm."chatId" = m."chatId" AND cm."userId" = m."senderUserId"
      WHERE m."chatId" = ${chatId}::uuid AND m."telegramDate" >= ${from} AND u."isBot" = false
      GROUP BY cm."id", u."displayName", u."username"
      ORDER BY messages DESC
      LIMIT 10
    `,
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { chatId, action: { in: [...AUTOMOD_RULE_ACTIONS] }, createdAt: { gte: from, lte: now } },
      _count: { _all: true }
    })
  ]);

  const messageMap = new Map(messageTrend.map((row) => [row.bucket, Number(row.count)]));
  const joinMap = new Map(joinTrend.map((row) => [row.bucket, Number(row.count)]));
  const moderationMap = new Map(moderationTrend.map((row) => [row.bucket, Number(row.count)]));
  const trend = buildTrendSlots(period, from, now).map((slot) => ({
    at: slot.at,
    label: slot.label,
    messages: messageMap.get(slot.key) ?? 0,
    newMembers: joinMap.get(slot.key) ?? 0,
    moderationActions: moderationMap.get(slot.key) ?? 0
  }));

  const ruleBreakdownCounts = new Map(ruleBreakdownRows.map((row) => [row.action, row._count._all]));
  const ruleBreakdown = AUTOMOD_RULE_ACTIONS.map((action) => ({
    rule: AUTOMOD_RULE_LABELS[action],
    count: ruleBreakdownCounts.get(action) ?? 0
  })).filter((row) => row.count > 0);

  return {
    period,
    generatedAt: now.toISOString(),
    trend,
    topMembers: topMembersRows.map((row) => ({
      membershipId: row.membershipId,
      displayName: row.displayName,
      username: row.username,
      messages: Number(row.messages)
    })),
    ruleBreakdown
  };
}
