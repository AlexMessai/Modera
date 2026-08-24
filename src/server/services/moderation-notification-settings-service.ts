import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { DEFAULT_MANUAL_MODERATION_SETTINGS, renderManualModerationTemplate } from "@/server/services/manual-moderation-settings-service";
import { getTelegramClient } from "@/server/telegram/client";

export const MODERATION_NOTIFICATION_EVENTS = ["WARNING", "UNWARN", "MUTE", "UNMUTE", "BAN", "UNBAN", "KICK"] as const;
export type ModerationNotificationEvent = (typeof MODERATION_NOTIFICATION_EVENTS)[number];
export const MODERATION_NOTIFICATION_AUDIENCES = ["OFFENDER", "PUBLIC", "MODERATOR"] as const;
export type ModerationNotificationAudience = (typeof MODERATION_NOTIFICATION_AUDIENCES)[number];

export type ModerationNotificationChannel = {
  enabled: boolean;
  text: string;
};

export type ModerationNotificationProfile = {
  event: ModerationNotificationEvent;
  channels: Record<ModerationNotificationAudience, ModerationNotificationChannel>;
};

const GLOBAL_ID = "global";
const MAX_TEMPLATE_LENGTH = 1000;

type LegacySettings = {
  publicPunishmentMessagesEnabled: boolean;
  privatePunishmentMessagesEnabled: boolean;
  warnMessageTemplate: string;
  warnEphemeralMessageTemplate: string;
  unwarnMessageTemplate: string;
  muteMessageTemplate: string;
  muteEphemeralMessageTemplate: string;
  unmuteMessageTemplate: string;
  banMessageTemplate: string;
  banEphemeralMessageTemplate: string;
  unbanMessageTemplate: string;
  kickMessageTemplate: string;
};

const PUBLIC_FIELD: Record<ModerationNotificationEvent, keyof LegacySettings> = {
  WARNING: "warnMessageTemplate",
  UNWARN: "unwarnMessageTemplate",
  MUTE: "muteMessageTemplate",
  UNMUTE: "unmuteMessageTemplate",
  BAN: "banMessageTemplate",
  UNBAN: "unbanMessageTemplate",
  KICK: "kickMessageTemplate"
};

const OFFENDER_DEFAULTS: Record<ModerationNotificationEvent, string> = {
  WARNING: DEFAULT_MANUAL_MODERATION_SETTINGS.warnEphemeralMessageTemplate,
  UNWARN: "✅ В чате «%chat%» с вас снято предупреждение. Активных предупреждений: %warns%.",
  MUTE: DEFAULT_MANUAL_MODERATION_SETTINGS.muteEphemeralMessageTemplate,
  UNMUTE: "🔊 В чате «%chat%» с вас снят mute. Вы снова можете отправлять сообщения.",
  BAN: DEFAULT_MANUAL_MODERATION_SETTINGS.banEphemeralMessageTemplate,
  UNBAN: "✅ В чате «%chat%» с вас снята блокировка.",
  KICK: "👢 Вы были исключены из чата «%chat%». %reason%"
};

function template(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_TEMPLATE_LENGTH) : fallback;
}

function defaultsFromLegacy(legacy: LegacySettings): ModerationNotificationProfile[] {
  return MODERATION_NOTIFICATION_EVENTS.map((event) => {
    const publicText = String(legacy[PUBLIC_FIELD[event]]);
    const offenderText = event === "WARNING"
      ? legacy.warnEphemeralMessageTemplate
      : event === "MUTE"
        ? legacy.muteEphemeralMessageTemplate
        : event === "BAN"
          ? legacy.banEphemeralMessageTemplate
          : OFFENDER_DEFAULTS[event];
    return {
      event,
      channels: {
        OFFENDER: {
          enabled: legacy.privatePunishmentMessagesEnabled && (event === "WARNING" || event === "MUTE" || event === "BAN"),
          text: offenderText
        },
        PUBLIC: { enabled: legacy.publicPunishmentMessagesEnabled, text: publicText },
        MODERATOR: { enabled: true, text: publicText }
      }
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeModerationNotificationProfiles(
  value: unknown,
  legacy: LegacySettings
): ModerationNotificationProfile[] {
  const defaults = defaultsFromLegacy(legacy);
  const input = Array.isArray(value) ? value : [];
  return defaults.map((fallback) => {
    const raw = input.find((item) => isRecord(item) && item.event === fallback.event);
    if (!isRecord(raw) || !isRecord(raw.channels)) return fallback;
    const channels = { ...fallback.channels };
    for (const audience of MODERATION_NOTIFICATION_AUDIENCES) {
      const candidate = raw.channels[audience];
      if (!isRecord(candidate)) continue;
      channels[audience] = {
        enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : channels[audience].enabled,
        text: template(candidate.text, channels[audience].text)
      };
    }
    return { event: fallback.event, channels };
  });
}

function defaultLegacy(): LegacySettings {
  return {
    publicPunishmentMessagesEnabled: true,
    privatePunishmentMessagesEnabled: true,
    ...DEFAULT_MANUAL_MODERATION_SETTINGS
  };
}

export async function getModerationNotificationProfiles(): Promise<ModerationNotificationProfile[]> {
  const stored = await prisma.globalManualModerationSettings.findUnique({ where: { id: GLOBAL_ID } });
  const legacy = stored ?? defaultLegacy();
  return normalizeModerationNotificationProfiles(stored?.notificationProfiles, legacy);
}

export async function getModerationNotificationProfile(event: ModerationNotificationEvent) {
  const profiles = await getModerationNotificationProfiles();
  return profiles.find((profile) => profile.event === event) ?? profiles[0];
}

export async function updateModerationNotificationProfiles(input: {
  actingAdminId: string;
  profiles: ModerationNotificationProfile[];
}) {
  const existing = await prisma.globalManualModerationSettings.findUnique({ where: { id: GLOBAL_ID } });
  const legacy = existing ?? defaultLegacy();
  const profiles = normalizeModerationNotificationProfiles(input.profiles, legacy);
  const byEvent = Object.fromEntries(profiles.map((profile) => [profile.event, profile])) as Record<ModerationNotificationEvent, ModerationNotificationProfile>;
  const legacyText = {
    warnMessageTemplate: byEvent.WARNING.channels.MODERATOR.text,
    warnEphemeralMessageTemplate: byEvent.WARNING.channels.OFFENDER.text,
    unwarnMessageTemplate: byEvent.UNWARN.channels.MODERATOR.text,
    muteMessageTemplate: byEvent.MUTE.channels.MODERATOR.text,
    muteEphemeralMessageTemplate: byEvent.MUTE.channels.OFFENDER.text,
    unmuteMessageTemplate: byEvent.UNMUTE.channels.MODERATOR.text,
    banMessageTemplate: byEvent.BAN.channels.MODERATOR.text,
    banEphemeralMessageTemplate: byEvent.BAN.channels.OFFENDER.text,
    unbanMessageTemplate: byEvent.UNBAN.channels.MODERATOR.text,
    kickMessageTemplate: byEvent.KICK.channels.MODERATOR.text
  };
  await prisma.$transaction(async (tx) => {
    await tx.globalManualModerationSettings.upsert({
      where: { id: GLOBAL_ID },
      create: {
        id: GLOBAL_ID,
        ...DEFAULT_MANUAL_MODERATION_SETTINGS,
        ...legacyText,
        publicPunishmentMessagesEnabled: profiles.some((profile) => profile.channels.PUBLIC.enabled),
        privatePunishmentMessagesEnabled: profiles.some((profile) => profile.channels.OFFENDER.enabled),
        notificationProfiles: profiles as unknown as Prisma.InputJsonValue
      },
      update: {
        ...legacyText,
        publicPunishmentMessagesEnabled: profiles.some((profile) => profile.channels.PUBLIC.enabled),
        privatePunishmentMessagesEnabled: profiles.some((profile) => profile.channels.OFFENDER.enabled),
        notificationProfiles: profiles as unknown as Prisma.InputJsonValue
      }
    });
    await tx.auditLog.create({
      data: {
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "MODERATION_NOTIFICATION_PROFILES_UPDATED",
        metadata: { profiles } as unknown as Prisma.InputJsonValue
      }
    });
  });
  return profiles;
}

export function renderModerationNotification(
  channel: ModerationNotificationChannel,
  placeholders: Parameters<typeof renderManualModerationTemplate>[1]
) {
  return renderManualModerationTemplate(channel.text, placeholders);
}

export async function sendPublicModerationNotification(input: {
  event: ModerationNotificationEvent;
  telegramChatId: bigint;
  target: string;
  reason?: string | null;
  duration?: string;
  warns?: string;
  warnsLimit?: string;
}) {
  const profile = await getModerationNotificationProfile(input.event);
  if (!profile.channels.PUBLIC.enabled) return { delivered: false as const };
  await getTelegramClient().sendMessage({
    chatId: Number(input.telegramChatId),
    text: renderModerationNotification(profile.channels.PUBLIC, {
      admin: "Администратор",
      target: input.target,
      reason: input.reason ?? "",
      duration: input.duration ?? "",
      warns: input.warns ?? "",
      warnsLimit: input.warnsLimit ?? ""
    })
  });
  return { delivered: true as const };
}
