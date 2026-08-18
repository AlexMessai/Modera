import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { resolveEffectiveAntiRaidSettings } from "@/server/services/anti-raid-settings-service";
import { isProtectedMemberStatus } from "@/server/services/moderation-service";
import {
  getTelegramBotProfile,
  getTelegramClient,
  MUTED_CHAT_PERMISSIONS,
  TelegramApiError
} from "@/server/telegram/client";
import { extractBotPermissions } from "@/server/telegram/status";

export const ANTI_RAID_SIGNAL_KINDS = ["JOIN", "JOIN_REQUEST"] as const;
export type AntiRaidSignalKind = (typeof ANTI_RAID_SIGNAL_KINDS)[number];

function incidentPayload(incident: {
  id: string;
  chatId: string;
  mode: string;
  triggeredBy: string;
  signalCount: number;
  joinRequestCount: number;
  joinCount: number;
  startedAt: Date;
  activeUntil: Date;
}) {
  return {
    id: incident.id,
    chatId: incident.chatId,
    mode: incident.mode,
    triggeredBy: incident.triggeredBy,
    signalCount: incident.signalCount,
    joinRequestCount: incident.joinRequestCount,
    joinCount: incident.joinCount,
    startedAt: incident.startedAt.toISOString(),
    activeUntil: incident.activeUntil.toISOString()
  };
}

export async function closeExpiredRaidIncidents(chatId?: string, at = new Date()) {
  const expired = await prisma.raidIncident.findMany({
    where: {
      status: "ACTIVE",
      activeUntil: { lte: at },
      ...(chatId ? { chatId } : {})
    },
    select: { id: true, chatId: true, startedAt: true, activeUntil: true }
  });

  let closed = 0;
  for (const incident of expired) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.raidIncident.updateMany({
        where: { id: incident.id, status: "ACTIVE" },
        data: { status: "ENDED", endedAt: at }
      });
      if (updated.count !== 1) return;
      closed += 1;
      await tx.auditLog.create({
        data: {
          chatId: incident.chatId,
          source: "SYSTEM",
          action: "RAID_ENDED",
          metadata: {
            raidIncidentId: incident.id,
            startedAt: incident.startedAt.toISOString(),
            activeUntil: incident.activeUntil.toISOString(),
            endedAt: at.toISOString()
          }
        }
      });
    });
  }
  return closed;
}

async function loadSignalCounts(chatId: string, since: Date, until: Date) {
  const [joinRequestCount, joinCount] = await Promise.all([
    prisma.joinRequest.count({
      where: { chatId, requestedAt: { gte: since, lte: until } }
    }),
    prisma.chatMember.count({
      where: { chatId, joinedAt: { gte: since, lte: until } }
    })
  ]);

  return {
    joinRequestCount,
    joinCount,
    signalCount: Math.max(joinRequestCount, joinCount)
  };
}

async function createIncident(input: {
  chatId: string;
  kind: AntiRaidSignalKind;
  occurredAt: Date;
  source: "CHAT" | "GLOBAL";
  settings: Awaited<ReturnType<typeof resolveEffectiveAntiRaidSettings>>["settings"];
  counts: { signalCount: number; joinRequestCount: number; joinCount: number };
}) {
  const activeUntil = new Date(
    input.occurredAt.getTime() + input.settings.protectionDurationMinutes * 60_000
  );
  const windowStartedAt = new Date(
    input.occurredAt.getTime() - input.settings.windowSeconds * 1000
  );

  try {
    return await prisma.$transaction(async (tx) => {
      const incident = await tx.raidIncident.create({
        data: {
          chatId: input.chatId,
          mode: input.settings.mode,
          triggeredBy: input.kind,
          signalCount: input.counts.signalCount,
          joinRequestCount: input.counts.joinRequestCount,
          joinCount: input.counts.joinCount,
          windowStartedAt,
          startedAt: input.occurredAt,
          activeUntil,
          metadata: {
            policySource: input.source,
            joinThreshold: input.settings.joinThreshold,
            windowSeconds: input.settings.windowSeconds,
            protectionDurationMinutes: input.settings.protectionDurationMinutes,
            newMemberMuteMinutes: input.settings.newMemberMuteMinutes
          }
        }
      });
      await tx.auditLog.create({
        data: {
          chatId: input.chatId,
          source: "SYSTEM",
          action: "RAID_STARTED",
          reason: `${input.counts.signalCount} вступлений или заявок за ${input.settings.windowSeconds} сек.`,
          metadata: {
            raidIncidentId: incident.id,
            mode: incident.mode,
            triggeredBy: input.kind,
            signalCount: input.counts.signalCount,
            joinRequestCount: input.counts.joinRequestCount,
            joinCount: input.counts.joinCount,
            activeUntil: activeUntil.toISOString(),
            policySource: input.source
          }
        }
      });
      return incident;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.raidIncident.findFirst({
        where: { chatId: input.chatId, status: "ACTIVE" },
        orderBy: { startedAt: "desc" }
      });
    }
    throw error;
  }
}

async function muteNewMemberForRaid(input: {
  membershipId: string;
  incidentId: string;
  muteMinutes: number;
}) {
  const member = await prisma.chatMember.findUnique({
    where: { id: input.membershipId },
    include: { user: true, chat: true }
  });
  if (!member || member.user.isBot) return { muted: false, reason: "MEMBER_UNAVAILABLE" as const };
  if (isProtectedMemberStatus(member.status)) {
    await prisma.auditLog.create({
      data: {
        chatId: member.chatId,
        affectedUserId: member.userId,
        source: "SYSTEM",
        action: "RAID_MITIGATION_SKIPPED_PROTECTED",
        metadata: { raidIncidentId: input.incidentId }
      }
    });
    return { muted: false, reason: "PROTECTED" as const };
  }
  if (member.chat.type !== "supergroup") return { muted: false, reason: "SUPERGROUP_REQUIRED" as const };
  if (member.punishmentState === "MUTED" || member.punishmentState === "BANNED") {
    return { muted: false, reason: "ALREADY_PUNISHED" as const };
  }

  const expiresAt = new Date(Date.now() + input.muteMinutes * 60_000);
  const reason = `Anti-Raid: временное ограничение нового участника на ${input.muteMinutes} мин.`;
  const action = await prisma.moderationAction.create({
    data: {
      chatId: member.chatId,
      affectedUserId: member.userId,
      actingAdminId: null,
      source: "SYSTEM",
      type: "MUTE",
      status: "PENDING",
      reason,
      expiresAt,
      metadata: {
        automated: true,
        antiRaid: true,
        raidIncidentId: input.incidentId,
        muteDurationMinutes: input.muteMinutes
      }
    }
  });

  try {
    const client = getTelegramClient();
    const bot = await getTelegramBotProfile();
    const [botMember, targetMember] = await Promise.all([
      client.getChatMember(Number(member.chat.telegramChatId), bot.id),
      client.getChatMember(Number(member.chat.telegramChatId), Number(member.user.telegramUserId))
    ]);
    const permissions = extractBotPermissions(botMember);
    if (
      (botMember.status !== "administrator" && botMember.status !== "creator") ||
      !permissions.canRestrictMembers
    ) {
      throw new Error("У бота нет права ограничивать участников в этом чате.");
    }
    if (targetMember.status === "administrator" || targetMember.status === "creator") {
      throw new Error("Telegram не позволяет ограничить владельца или администратора чата.");
    }
    if (targetMember.status === "left" || targetMember.status === "kicked") {
      throw new Error("Пользователь уже не состоит в чате.");
    }

    await client.restrictChatMember({
      chatId: Number(member.chat.telegramChatId),
      userId: Number(member.user.telegramUserId),
      permissions: MUTED_CHAT_PERMISSIONS,
      untilDate: Math.floor(expiresAt.getTime() / 1000)
    });
  } catch (error) {
    const message = error instanceof TelegramApiError || error instanceof Error
      ? error.message
      : "Telegram не выполнил Anti-Raid ограничение.";
    await prisma.$transaction([
      prisma.moderationAction.update({
        where: { id: action.id },
        data: { status: "FAILED", completedAt: new Date(), telegramError: message.slice(0, 500) }
      }),
      prisma.auditLog.create({
        data: {
          chatId: member.chatId,
          affectedUserId: member.userId,
          source: "SYSTEM",
          action: "RAID_MITIGATION_FAILED",
          reason,
          metadata: {
            raidIncidentId: input.incidentId,
            moderationActionId: action.id,
            error: message.slice(0, 500)
          }
        }
      })
    ]);
    return { muted: false, reason: "TELEGRAM_FAILED" as const };
  }

  const completedAt = new Date();
  try {
    await prisma.$transaction([
      prisma.chatMember.update({
        where: { id: member.id },
        data: {
          status: "RESTRICTED",
          punishmentState: "MUTED",
          punishmentExpiresAt: expiresAt,
          lastModerationAt: completedAt,
          leftAt: null
        }
      }),
      prisma.moderationAction.update({
        where: { id: action.id },
        data: { status: "SUCCEEDED", completedAt, telegramError: null }
      }),
      prisma.auditLog.create({
        data: {
          chatId: member.chatId,
          affectedUserId: member.userId,
          source: "SYSTEM",
          action: "RAID_MEMBER_MUTED",
          reason,
          metadata: {
            raidIncidentId: input.incidentId,
            moderationActionId: action.id,
            expiresAt: expiresAt.toISOString()
          }
        }
      })
    ]);
  } catch {
    return { muted: true, reconciliationRequired: true } as const;
  }

  return { muted: true, reconciliationRequired: false } as const;
}

export async function processAntiRaidSignal(input: {
  chatId: string;
  kind: AntiRaidSignalKind;
  occurredAt: Date;
  membershipId?: string;
}) {
  const resolved = await resolveEffectiveAntiRaidSettings(input.chatId);
  if (!resolved.settings.enabled) {
    return { enabled: false, incident: null, mitigation: null } as const;
  }

  await closeExpiredRaidIncidents(input.chatId, input.occurredAt);
  let incident = await prisma.raidIncident.findFirst({
    where: {
      chatId: input.chatId,
      status: "ACTIVE",
      activeUntil: { gt: input.occurredAt }
    },
    orderBy: { startedAt: "desc" }
  });

  if (!incident) {
    const since = new Date(input.occurredAt.getTime() - resolved.settings.windowSeconds * 1000);
    const counts = await loadSignalCounts(input.chatId, since, input.occurredAt);
    if (counts.signalCount >= resolved.settings.joinThreshold) {
      incident = await createIncident({
        chatId: input.chatId,
        kind: input.kind,
        occurredAt: input.occurredAt,
        source: resolved.source,
        settings: resolved.settings,
        counts
      });
    }
  }

  if (!incident) {
    return { enabled: true, incident: null, mitigation: null } as const;
  }

  let mitigation: Awaited<ReturnType<typeof muteNewMemberForRaid>> | null = null;
  if (
    incident.mode === "MUTE_NEW_MEMBERS" &&
    input.kind === "JOIN" &&
    input.membershipId
  ) {
    mitigation = await muteNewMemberForRaid({
      membershipId: input.membershipId,
      incidentId: incident.id,
      muteMinutes: resolved.settings.newMemberMuteMinutes
    });
  }

  return {
    enabled: true,
    incident: incidentPayload(incident),
    mitigation
  };
}

export async function getAntiRaidOverview() {
  await closeExpiredRaidIncidents();
  const [globalProfile, chats, incidents24h] = await Promise.all([
    prisma.globalAntiRaidSettings.findUnique({ where: { id: "global" } }),
    prisma.chat.findMany({
      orderBy: { lastActivityAt: "desc" },
      take: 200,
      include: {
        antiRaidSettings: true,
        raidIncidents: {
          where: { status: "ACTIVE" },
          orderBy: { startedAt: "desc" },
          take: 1
        },
        botLinks: {
          orderBy: { lastSeenAt: "desc" },
          take: 1,
          select: { status: true, permissions: true }
        }
      }
    }),
    prisma.raidIncident.findMany({
      where: { startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { chat: { select: { id: true, title: true } } }
    })
  ]);

  return {
    globalPersisted: Boolean(globalProfile),
    activeIncidents: chats.filter((chat) => chat.raidIncidents.length > 0).length,
    incidents24h: incidents24h.length,
    chats: chats.map((chat) => {
      const permissions = chat.botLinks[0]?.permissions as { canRestrictMembers?: boolean } | null | undefined;
      return {
        id: chat.id,
        title: chat.title,
        telegramChatId: chat.telegramChatId.toString(),
        useGlobalProfile: chat.antiRaidSettings?.useGlobalProfile ?? false,
        localEnabled: chat.antiRaidSettings?.enabled ?? false,
        botStatus: chat.botLinks[0]?.status ?? "DISABLED",
        canRestrictMembers: Boolean(permissions?.canRestrictMembers),
        activeIncident: chat.raidIncidents[0]
          ? {
              id: chat.raidIncidents[0].id,
              mode: chat.raidIncidents[0].mode,
              signalCount: chat.raidIncidents[0].signalCount,
              startedAt: chat.raidIncidents[0].startedAt.toISOString(),
              activeUntil: chat.raidIncidents[0].activeUntil.toISOString()
            }
          : null
      };
    }),
    incidents: incidents24h.map((incident) => ({
      id: incident.id,
      status: incident.status,
      mode: incident.mode,
      triggeredBy: incident.triggeredBy,
      signalCount: incident.signalCount,
      joinRequestCount: incident.joinRequestCount,
      joinCount: incident.joinCount,
      startedAt: incident.startedAt.toISOString(),
      activeUntil: incident.activeUntil.toISOString(),
      endedAt: incident.endedAt?.toISOString() ?? null,
      chat: incident.chat
    }))
  };
}
