import { prisma } from "@/server/db/prisma";

export const DASHBOARD_PERIODS = ["24H", "7D", "30D"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

const AUTOMOD_ENFORCEMENT_ACTIONS = [
  "AUTOMOD_LINK_DELETED",
  "AUTOMOD_TERM_DELETED",
  "AUTOMOD_MEDIA_DELETED",
  "AUTOMOD_MENTIONS_DELETED",
  "AUTOMOD_DUPLICATE_DELETED",
  "AUTOMOD_SPAM_DELETED",
  "AUTOMOD_WARNING",
  "AUTOMOD_AUTO_MUTE",
  "AUTOMOD_AUTO_BAN"
];

const ERROR_ACTIONS = [
  "MODERATION_ACTION_FAILED",
  "MODERATION_RECONCILIATION_CHECK_FAILED",
  "AUTOMOD_DELETE_FAILED",
  "AUTOMOD_ESCALATION_FAILED",
  "MANUAL_MESSAGE_DELETE_FAILED",
  "RAID_MITIGATION_FAILED",
  "JOIN_REQUEST_ACTION_FAILED",
  "MEMBER_TAG_UPDATE_FAILED"
];

const RECENT_ACTIONS = [
  "RAID_STARTED",
  "RAID_ENDED",
  "RAID_MEMBER_MUTED",
  "AUTOMOD_AUTO_MUTE",
  "AUTOMOD_AUTO_BAN",
  "MODERATION_MUTE",
  "MODERATION_BAN",
  "TRUSTED_MEMBER_ADDED",
  "TRUSTED_MEMBER_REMOVED",
  "MEMBER_TAG_UPDATED",
  "MEMBER_TAG_REMOVED",
  "TELEGRAM_MEMBER_TAG_CHANGED",
  "TELEGRAM_MEMBER_TAG_REMOVED",
  "JOIN_REQUEST_APPROVED",
  "JOIN_REQUEST_DECLINED",
  ...ERROR_ACTIONS
];

function periodMilliseconds(period: DashboardPeriod) {
  if (period === "24H") return 24 * 60 * 60 * 1000;
  if (period === "7D") return 7 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

function comparisonPercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function hourKey(date: Date) {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy.toISOString().replace(".000Z", "Z");
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildTrendSlots(period: DashboardPeriod, from: Date, now: Date) {
  const hourly = period === "24H";
  const result: Array<{ key: string; at: string; label: string }> = [];
  const cursor = new Date(from);

  if (hourly) {
    cursor.setUTCMinutes(0, 0, 0);
    while (cursor <= now) {
      const key = hourKey(cursor);
      result.push({
        key,
        at: new Date(cursor).toISOString(),
        label: new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC"
        }).format(cursor)
      });
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }
    return result.slice(-24);
  }

  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= now) {
    const key = dayKey(cursor);
    result.push({
      key,
      at: `${key}T00:00:00.000Z`,
      label: new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: period === "30D" ? "short" : "2-digit",
        timeZone: "UTC"
      }).format(cursor)
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result.slice(period === "7D" ? -7 : -30);
}

type TrendRow = { bucket: string; count: number };

async function loadMessageTrend(period: DashboardPeriod, from: Date) {
  if (period === "24H") {
    return prisma.$queryRaw<TrendRow[]>`
      SELECT
        to_char(date_trunc('hour', "telegramDate" AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS bucket,
        COUNT(*)::int AS count
      FROM "Message"
      WHERE "telegramDate" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }
  return prisma.$queryRaw<TrendRow[]>`
    SELECT
      (date_trunc('day', "telegramDate" AT TIME ZONE 'UTC'))::date::text AS bucket,
      COUNT(*)::int AS count
    FROM "Message"
    WHERE "telegramDate" >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;
}

async function loadJoinTrend(period: DashboardPeriod, from: Date) {
  if (period === "24H") {
    return prisma.$queryRaw<TrendRow[]>`
      SELECT
        to_char(date_trunc('hour', "joinedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS bucket,
        COUNT(*)::int AS count
      FROM "ChatMember"
      WHERE "joinedAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }
  return prisma.$queryRaw<TrendRow[]>`
    SELECT
      (date_trunc('day', "joinedAt" AT TIME ZONE 'UTC'))::date::text AS bucket,
      COUNT(*)::int AS count
    FROM "ChatMember"
    WHERE "joinedAt" >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;
}

async function loadModerationTrend(period: DashboardPeriod, from: Date) {
  if (period === "24H") {
    return prisma.$queryRaw<TrendRow[]>`
      SELECT
        to_char(date_trunc('hour', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS bucket,
        COUNT(*)::int AS count
      FROM "ModerationAction"
      WHERE "createdAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }
  return prisma.$queryRaw<TrendRow[]>`
    SELECT
      (date_trunc('day', "createdAt" AT TIME ZONE 'UTC'))::date::text AS bucket,
      COUNT(*)::int AS count
    FROM "ModerationAction"
    WHERE "createdAt" >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;
}

export async function getDashboardData(period: DashboardPeriod) {
  const now = new Date();
  const duration = periodMilliseconds(period);
  const from = new Date(now.getTime() - duration);
  const previousFrom = new Date(from.getTime() - duration);

  const [
    chats,
    activeBotLinks,
    knownUsers,
    trustedUsers,
    messages,
    previousMessages,
    newMembers,
    previousNewMembers,
    joinRequests,
    previousJoinRequests,
    moderationActions,
    previousModerationActions,
    automodActions,
    previousAutomodActions,
    raids,
    previousRaids,
    pendingJoinRequests,
    pendingModerationActions,
    problematicBotLinks,
    activeRaids,
    errors,
    messageTrend,
    joinTrend,
    moderationTrend,
    topChatsRows,
    recentEvents
  ] = await Promise.all([
    prisma.chat.count(),
    prisma.botChat.count({ where: { status: "ACTIVE" } }),
    prisma.telegramUser.count({ where: { isBot: false } }),
    prisma.chatMember.count({ where: { internalRole: "TRUSTED" } }),
    prisma.message.count({ where: { telegramDate: { gte: from, lte: now } } }),
    prisma.message.count({ where: { telegramDate: { gte: previousFrom, lt: from } } }),
    prisma.chatMember.count({ where: { joinedAt: { gte: from, lte: now } } }),
    prisma.chatMember.count({ where: { joinedAt: { gte: previousFrom, lt: from } } }),
    prisma.joinRequest.count({ where: { requestedAt: { gte: from, lte: now } } }),
    prisma.joinRequest.count({ where: { requestedAt: { gte: previousFrom, lt: from } } }),
    prisma.moderationAction.count({ where: { createdAt: { gte: from, lte: now } } }),
    prisma.moderationAction.count({ where: { createdAt: { gte: previousFrom, lt: from } } }),
    prisma.auditLog.count({ where: { action: { in: AUTOMOD_ENFORCEMENT_ACTIONS }, createdAt: { gte: from, lte: now } } }),
    prisma.auditLog.count({ where: { action: { in: AUTOMOD_ENFORCEMENT_ACTIONS }, createdAt: { gte: previousFrom, lt: from } } }),
    prisma.raidIncident.count({ where: { startedAt: { gte: from, lte: now } } }),
    prisma.raidIncident.count({ where: { startedAt: { gte: previousFrom, lt: from } } }),
    prisma.joinRequest.count({ where: { status: "PENDING" } }),
    prisma.moderationAction.count({ where: { status: "PENDING" } }),
    prisma.botChat.count({ where: { status: { not: "ACTIVE" } } }),
    prisma.raidIncident.count({ where: { status: "ACTIVE", activeUntil: { gt: now } } }),
    prisma.auditLog.count({ where: { action: { in: ERROR_ACTIONS }, createdAt: { gte: from, lte: now } } }),
    loadMessageTrend(period, from),
    loadJoinTrend(period, from),
    loadModerationTrend(period, from),
    prisma.$queryRaw<Array<{ id: string; title: string; telegramChatId: bigint; messages: number }>>`
      SELECT c."id", c."title", c."telegramChatId", COUNT(m."id")::int AS messages
      FROM "Message" m
      JOIN "Chat" c ON c."id" = m."chatId"
      WHERE m."telegramDate" >= ${from}
      GROUP BY c."id", c."title", c."telegramChatId"
      ORDER BY messages DESC
      LIMIT 8
    `,
    prisma.auditLog.findMany({
      where: { action: { in: RECENT_ACTIONS }, createdAt: { gte: from } },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        chat: { select: { id: true, title: true } },
        affectedUser: { select: { id: true, displayName: true, username: true } },
        actingAdmin: { select: { displayName: true } }
      }
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

  return {
    generatedAt: now.toISOString(),
    period,
    totals: {
      chats,
      activeBotLinks,
      knownUsers,
      trustedUsers
    },
    metrics: {
      messages: { current: messages, previous: previousMessages, deltaPercent: comparisonPercent(messages, previousMessages) },
      newMembers: { current: newMembers, previous: previousNewMembers, deltaPercent: comparisonPercent(newMembers, previousNewMembers) },
      joinRequests: { current: joinRequests, previous: previousJoinRequests, deltaPercent: comparisonPercent(joinRequests, previousJoinRequests) },
      moderationActions: { current: moderationActions, previous: previousModerationActions, deltaPercent: comparisonPercent(moderationActions, previousModerationActions) },
      automodActions: { current: automodActions, previous: previousAutomodActions, deltaPercent: comparisonPercent(automodActions, previousAutomodActions) },
      raids: { current: raids, previous: previousRaids, deltaPercent: comparisonPercent(raids, previousRaids) }
    },
    attention: {
      pendingJoinRequests,
      pendingModerationActions,
      problematicBotLinks,
      activeRaids,
      errors
    },
    trend,
    topChats: topChatsRows.map((chat) => ({
      id: chat.id,
      title: chat.title,
      telegramChatId: chat.telegramChatId.toString(),
      messages: Number(chat.messages)
    })),
    recentEvents: recentEvents.map((event) => ({
      id: event.id,
      action: event.action,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
      source: event.source,
      chat: event.chat,
      affectedUser: event.affectedUser,
      actingAdmin: event.actingAdmin
    }))
  };
}
