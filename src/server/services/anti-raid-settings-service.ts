import { prisma } from "@/server/db/prisma";

export type AntiRaidSettingsValue = {
  enabled: boolean;
  /** How many joins within `windowSeconds` counts as a raid — spec's example: "30 joins за 20 секунд". */
  joinThreshold: number;
  windowSeconds: number;
  /** How long without a new join before an active raid is considered resolved (swept by the daily cron). */
  cooldownMinutes: number;
  /** Forces CAPTCHA on for new joiners while a raid is active, even if the chat's own CAPTCHA is off. */
  forceCaptcha: boolean;
};

export const DEFAULT_ANTI_RAID_SETTINGS: AntiRaidSettingsValue = {
  enabled: false,
  joinThreshold: 30,
  windowSeconds: 20,
  cooldownMinutes: 15,
  forceCaptcha: true
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeAntiRaidSettings(input: AntiRaidSettingsValue): AntiRaidSettingsValue {
  return {
    enabled: Boolean(input.enabled),
    joinThreshold: boundedInteger(input.joinThreshold, 3, 500),
    windowSeconds: boundedInteger(input.windowSeconds, 5, 600),
    cooldownMinutes: boundedInteger(input.cooldownMinutes, 1, 1440),
    forceCaptcha: Boolean(input.forceCaptcha)
  };
}

export function serializeAntiRaidSettings(settings: AntiRaidSettingsValue): AntiRaidSettingsValue {
  return {
    enabled: settings.enabled,
    joinThreshold: settings.joinThreshold,
    windowSeconds: settings.windowSeconds,
    cooldownMinutes: settings.cooldownMinutes,
    forceCaptcha: settings.forceCaptcha
  };
}

export async function getChatAntiRaidProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { antiRaidSettings: true }
  });
  if (!chat) return null;

  const local = chat.antiRaidSettings;

  return {
    chat: {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type
    },
    settings: serializeAntiRaidSettings(local ?? DEFAULT_ANTI_RAID_SETTINGS)
  };
}

export async function updateChatAntiRaidSettings(input: {
  chatId: string;
  actingAdminId: string;
  settings: AntiRaidSettingsValue;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;
  const normalized = normalizeAntiRaidSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatAntiRaidSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, ...normalized },
      update: normalized
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "ANTI_RAID_SETTINGS_UPDATED",
        metadata: serializeAntiRaidSettings(settings)
      }
    });
    return settings;
  });
  return serializeAntiRaidSettings(saved);
}

export async function resolveEffectiveAntiRaidSettings(chatId: string) {
  const local = await prisma.chatAntiRaidSettings.findUnique({ where: { chatId } });
  return {
    source: "CHAT" as const,
    settings: serializeAntiRaidSettings(local ?? DEFAULT_ANTI_RAID_SETTINGS)
  };
}
