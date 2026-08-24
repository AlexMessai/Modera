import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { DEFAULT_MANUAL_MODERATION_SETTINGS, renderManualModerationTemplate } from "@/server/services/manual-moderation-settings-service";
import { getTelegramClient } from "@/server/telegram/client";
import type { TelegramMessageEntity } from "@/server/telegram/types";

export const MODERATION_NOTIFICATION_EVENTS = ["WARNING", "UNWARN", "MUTE", "UNMUTE", "BAN", "UNBAN", "KICK"] as const;
export type ModerationNotificationEvent = (typeof MODERATION_NOTIFICATION_EVENTS)[number];
export const MODERATION_NOTIFICATION_AUDIENCES = ["OFFENDER", "PUBLIC", "MODERATOR"] as const;
export type ModerationNotificationAudience = (typeof MODERATION_NOTIFICATION_AUDIENCES)[number];
export const MODERATION_NOTIFICATION_SOURCES = ["MANUAL", "AUTOMATED"] as const;
export type ModerationNotificationSource = (typeof MODERATION_NOTIFICATION_SOURCES)[number];

export type ModerationNotificationChannel = {
  enabled: boolean;
  templates: Record<ModerationNotificationSource, string>;
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

const MANUAL_PUBLIC_DEFAULTS: Record<ModerationNotificationEvent, string> = {
  WARNING: "%admin% выдал предупреждение пользователю %target%. Причина: %reason%",
  UNWARN: "%admin% снял предупреждение с %target%.",
  MUTE: "%admin% ограничил %target% на %duration%. Причина: %reason%",
  UNMUTE: "%admin% снял ограничение с %target%.",
  BAN: "%admin% заблокировал %target%. Причина: %reason%",
  UNBAN: "%admin% снял блокировку с %target%.",
  KICK: "%admin% исключил %target% из чата. Причина: %reason%"
};

function template(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_TEMPLATE_LENGTH) : fallback;
}

function defaultsFromLegacy(legacy: LegacySettings): ModerationNotificationProfile[] {
  return MODERATION_NOTIFICATION_EVENTS.map((event) => {
    const publicText = String(legacy[PUBLIC_FIELD[event]]);
    const automatedPublicText = String(defaultLegacy()[PUBLIC_FIELD[event]]);
    const manualPublicText = publicText === automatedPublicText ? MANUAL_PUBLIC_DEFAULTS[event] : publicText;
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
          templates: { MANUAL: offenderText, AUTOMATED: offenderText }
        },
        PUBLIC: { enabled: legacy.publicPunishmentMessagesEnabled, templates: { MANUAL: manualPublicText, AUTOMATED: automatedPublicText } },
        MODERATOR: { enabled: true, templates: { MANUAL: manualPublicText, AUTOMATED: automatedPublicText } }
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
      const legacyText = template(candidate.text, channels[audience].templates.MANUAL);
      const templates = isRecord(candidate.templates) ? candidate.templates : {};
      channels[audience] = {
        enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : channels[audience].enabled,
        templates: {
          MANUAL: template(templates.MANUAL, legacyText),
          AUTOMATED: template(templates.AUTOMATED, channels[audience].templates.AUTOMATED)
        }
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
    warnMessageTemplate: byEvent.WARNING.channels.MODERATOR.templates.MANUAL,
    warnEphemeralMessageTemplate: byEvent.WARNING.channels.OFFENDER.templates.MANUAL,
    unwarnMessageTemplate: byEvent.UNWARN.channels.MODERATOR.templates.MANUAL,
    muteMessageTemplate: byEvent.MUTE.channels.MODERATOR.templates.MANUAL,
    muteEphemeralMessageTemplate: byEvent.MUTE.channels.OFFENDER.templates.MANUAL,
    unmuteMessageTemplate: byEvent.UNMUTE.channels.MODERATOR.templates.MANUAL,
    banMessageTemplate: byEvent.BAN.channels.MODERATOR.templates.MANUAL,
    banEphemeralMessageTemplate: byEvent.BAN.channels.OFFENDER.templates.MANUAL,
    unbanMessageTemplate: byEvent.UNBAN.channels.MODERATOR.templates.MANUAL,
    kickMessageTemplate: byEvent.KICK.channels.MODERATOR.templates.MANUAL
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
  source: ModerationNotificationSource,
  placeholders: Parameters<typeof renderManualModerationTemplate>[1]
) {
  return renderManualModerationTemplate(channel.templates[source], placeholders);
}

type TelegramPlaceholder = string | { text: string; telegramUserId: number | bigint };

export function renderTelegramModerationNotification(
  channel: ModerationNotificationChannel,
  source: ModerationNotificationSource,
  placeholders: Partial<Record<"admin" | "target" | "reason" | "duration" | "warns" | "warnsLimit" | "chat" | "contact", TelegramPlaceholder>>
): { text: string; entities: TelegramMessageEntity[] } {
  return renderTelegramTemplate(channel.templates[source], placeholders);
}

export function renderTelegramTemplate(
  templateText: string,
  placeholders: Partial<Record<"admin" | "target" | "reason" | "duration" | "warns" | "warnsLimit" | "chat" | "contact", TelegramPlaceholder>>
): { text: string; entities: TelegramMessageEntity[] } {
  const tokens: Record<string, keyof typeof placeholders> = {
    "%admin%": "admin", "%target%": "target", "%reason%": "reason", "%duration%": "duration",
    "%warns_limit%": "warnsLimit", "%warns%": "warns", "%chat%": "chat", "%contact%": "contact"
  };
  const tokenPattern = /%admin%|%target%|%reason%|%duration%|%warns_limit%|%warns%|%chat%|%contact%/g;
  const entities: TelegramMessageEntity[] = [];
  let text = "";
  let cursor = 0;
  for (const match of templateText.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    text += templateText.slice(cursor, index);
    const value = placeholders[tokens[match[0]]];
    const replacement = typeof value === "object" && value ? value.text : value ?? "";
    const offset = text.length;
    text += replacement;
    if (typeof value === "object" && value && replacement) {
      entities.push({ type: "text_link", offset, length: replacement.length, url: `tg://user?id=${value.telegramUserId}` });
    }
    cursor = index + match[0].length;
  }
  text += templateText.slice(cursor);
  return { text, entities };
}

export async function sendPublicModerationNotification(input: {
  event: ModerationNotificationEvent;
  telegramChatId: bigint;
  target: string;
  targetTelegramUserId: bigint;
  reason?: string | null;
  duration?: string;
  warns?: string;
  warnsLimit?: string;
}) {
  const profile = await getModerationNotificationProfile(input.event);
  if (!profile.channels.PUBLIC.enabled) return { delivered: false as const };
  await getTelegramClient().sendMessage({
    chatId: Number(input.telegramChatId),
    ...renderTelegramModerationNotification(profile.channels.PUBLIC, "AUTOMATED", {
      admin: "",
      target: { text: input.target, telegramUserId: input.targetTelegramUserId },
      reason: input.reason ?? "",
      duration: input.duration ?? "",
      warns: input.warns ?? "",
      warnsLimit: input.warnsLimit ?? "",
      chat: "",
      contact: ""
    })
  });
  return { delivered: true as const };
}
