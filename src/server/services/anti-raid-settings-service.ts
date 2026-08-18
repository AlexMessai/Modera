import { prisma } from "@/server/db/prisma";

export const GLOBAL_ANTI_RAID_PROFILE_ID = "global";
export const ANTI_RAID_MODES = ["ALERT", "MUTE_NEW_MEMBERS"] as const;
export type AntiRaidModeValue = (typeof ANTI_RAID_MODES)[number];

export type AntiRaidSettingsValue = {
  enabled: boolean;
  joinThreshold: number;
  windowSeconds: number;
  protectionDurationMinutes: number;
  mode: AntiRaidModeValue;
  newMemberMuteMinutes: number;
};

export const DEFAULT_ANTI_RAID_SETTINGS: AntiRaidSettingsValue = {
  enabled: false,
  joinThreshold: 10,
  windowSeconds: 60,
  protectionDurationMinutes: 30,
  mode: "ALERT",
  newMemberMuteMinutes: 10
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeAntiRaidSettings(input: AntiRaidSettingsValue): AntiRaidSettingsValue {
  return {
    enabled: Boolean(input.enabled),
    joinThreshold: bounded(input.joinThreshold, 3, 500),
    windowSeconds: bounded(input.windowSeconds, 10, 600),
    protectionDurationMinutes: bounded(input.protectionDurationMinutes, 1, 1440),
    mode: ANTI_RAID_MODES.includes(input.mode) ? input.mode : "ALERT",
    newMemberMuteMinutes: bounded(input.newMemberMuteMinutes, 1, 10080)
  };
}

export function serializeAntiRaidSettings(settings: AntiRaidSettingsValue): AntiRaidSettingsValue {
  return {
    enabled: settings.enabled,
    joinThreshold: settings.joinThreshold,
    windowSeconds: settings.windowSeconds,
    protectionDurationMinutes: settings.protectionDurationMinutes,
    mode: settings.mode,
    newMemberMuteMinutes: settings.newMemberMuteMinutes
  };
}

export async function getGlobalAntiRaidProfile() {
  const stored = await prisma.globalAntiRaidSettings.findUnique({
    where: { id: GLOBAL_ANTI_RAID_PROFILE_ID }
  });
  return {
    persisted: Boolean(stored),
    settings: serializeAntiRaidSettings(stored ?? DEFAULT_ANTI_RAID_SETTINGS)
  };
}

export async function updateGlobalAntiRaidProfile(input: {
  actingAdminId: string;
  settings: AntiRaidSettingsValue;
}) {
  const normalized = normalizeAntiRaidSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.globalAntiRaidSettings.upsert({
      where: { id: GLOBAL_ANTI_RAID_PROFILE_ID },
      create: { id: GLOBAL_ANTI_RAID_PROFILE_ID, ...normalized },
      update: normalized
    });
    await tx.auditLog.create({
      data: {
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "GLOBAL_ANTI_RAID_SETTINGS_UPDATED",
        metadata: serializeAntiRaidSettings(settings)
      }
    });
    return settings;
  });
  return serializeAntiRaidSettings(saved);
}

export async function getChatAntiRaidProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      antiRaidSettings: true,
      botLinks: {
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: { status: true, permissions: true, lastError: true, lastSeenAt: true }
      }
    }
  });
  if (!chat) return null;

  const [globalProfile, activeIncident] = await Promise.all([
    getGlobalAntiRaidProfile(),
    prisma.raidIncident.findFirst({
      where: { chatId, status: "ACTIVE" },
      orderBy: { startedAt: "desc" }
    })
  ]);
  const local = chat.antiRaidSettings;
  const useGlobalProfile = local?.useGlobalProfile ?? false;
  const effective = useGlobalProfile
    ? globalProfile.settings
    : serializeAntiRaidSettings(local ?? DEFAULT_ANTI_RAID_SETTINGS);
  const permissions = chat.botLinks[0]?.permissions as
    | { canRestrictMembers?: boolean; canInviteUsers?: boolean }
    | null
    | undefined;

  return {
    chat: {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type
    },
    policy: {
      useGlobalProfile,
      effectiveSource: useGlobalProfile ? "GLOBAL" as const : "CHAT" as const,
      globalProfilePersisted: globalProfile.persisted
    },
    settings: serializeAntiRaidSettings(local ?? DEFAULT_ANTI_RAID_SETTINGS),
    effectiveSettings: serializeAntiRaidSettings(effective),
    globalSettings: serializeAntiRaidSettings(globalProfile.settings),
    bot: {
      status: chat.botLinks[0]?.status ?? "DISABLED",
      canRestrictMembers: Boolean(permissions?.canRestrictMembers),
      canInviteUsers: Boolean(permissions?.canInviteUsers),
      lastError: chat.botLinks[0]?.lastError ?? null,
      checkedAt: chat.botLinks[0]?.lastSeenAt?.toISOString() ?? null
    },
    activeIncident: activeIncident
      ? {
          id: activeIncident.id,
          mode: activeIncident.mode,
          triggeredBy: activeIncident.triggeredBy,
          signalCount: activeIncident.signalCount,
          startedAt: activeIncident.startedAt.toISOString(),
          activeUntil: activeIncident.activeUntil.toISOString()
        }
      : null
  };
}

export async function updateChatAntiRaidProfile(input: {
  chatId: string;
  actingAdminId: string;
  useGlobalProfile: boolean;
  settings: AntiRaidSettingsValue;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;
  const normalized = normalizeAntiRaidSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatAntiRaidSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, useGlobalProfile: input.useGlobalProfile, ...normalized },
      update: { useGlobalProfile: input.useGlobalProfile, ...normalized }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "ANTI_RAID_SETTINGS_UPDATED",
        metadata: {
          useGlobalProfile: settings.useGlobalProfile,
          ...serializeAntiRaidSettings(settings)
        }
      }
    });
    return settings;
  });
  return {
    useGlobalProfile: saved.useGlobalProfile,
    ...serializeAntiRaidSettings(saved)
  };
}

export async function resolveEffectiveAntiRaidSettings(chatId: string) {
  const local = await prisma.chatAntiRaidSettings.findUnique({ where: { chatId } });
  if (!local?.useGlobalProfile) {
    return {
      source: "CHAT" as const,
      useGlobalProfile: false,
      settings: serializeAntiRaidSettings(local ?? DEFAULT_ANTI_RAID_SETTINGS)
    };
  }
  const global = await prisma.globalAntiRaidSettings.findUnique({
    where: { id: GLOBAL_ANTI_RAID_PROFILE_ID }
  });
  return {
    source: "GLOBAL" as const,
    useGlobalProfile: true,
    settings: serializeAntiRaidSettings(global ?? DEFAULT_ANTI_RAID_SETTINGS)
  };
}