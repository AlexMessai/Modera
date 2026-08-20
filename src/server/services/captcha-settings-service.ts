import { prisma } from "@/server/db/prisma";

export const GLOBAL_CAPTCHA_PROFILE_ID = "global";

// Fixed rule, not configurable: mute on join, kick (never ban) whoever is
// still unverified at the next daily sweep -- no per-chat/global timeout or
// kick-vs-ban choice anymore. challengeMessageTemplate is the ephemeral
// "Я не бот" prompt text -- no placeholders, it's shown only to the joining
// member so there's nothing to interpolate.
export type CaptchaSettingsValue = {
  enabled: boolean;
  challengeMessageTemplate: string;
};

export const DEFAULT_CAPTCHA_SETTINGS: CaptchaSettingsValue = {
  enabled: false,
  challengeMessageTemplate: "Подтвердите, что вы не бот — нажмите кнопку ниже. Пока не подтвердите, вы не сможете писать в этом чате; если долго не подтвердите, вас исключат (без блокировки — сможете зайти снова)."
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTemplate(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1000) : fallback;
}

export function normalizeCaptchaSettings(input: CaptchaSettingsValue): CaptchaSettingsValue {
  return {
    enabled: Boolean(input.enabled),
    challengeMessageTemplate: normalizeTemplate(input.challengeMessageTemplate, DEFAULT_CAPTCHA_SETTINGS.challengeMessageTemplate)
  };
}

export function serializeCaptchaSettings(settings: CaptchaSettingsValue): CaptchaSettingsValue {
  return {
    enabled: settings.enabled,
    challengeMessageTemplate: settings.challengeMessageTemplate
  };
}

export async function getGlobalCaptchaProfile() {
  const stored = await prisma.globalCaptchaSettings.findUnique({
    where: { id: GLOBAL_CAPTCHA_PROFILE_ID }
  });
  return {
    persisted: Boolean(stored),
    settings: serializeCaptchaSettings(stored ?? DEFAULT_CAPTCHA_SETTINGS)
  };
}

export async function updateGlobalCaptchaProfile(input: {
  actingAdminId: string;
  settings: CaptchaSettingsValue;
}) {
  const normalized = normalizeCaptchaSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.globalCaptchaSettings.upsert({
      where: { id: GLOBAL_CAPTCHA_PROFILE_ID },
      create: { id: GLOBAL_CAPTCHA_PROFILE_ID, ...normalized },
      update: normalized
    });
    await tx.auditLog.create({
      data: {
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "GLOBAL_CAPTCHA_SETTINGS_UPDATED",
        metadata: serializeCaptchaSettings(settings)
      }
    });
    return settings;
  });
  return serializeCaptchaSettings(saved);
}

export async function getChatCaptchaProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      captchaSettings: true,
      botLinks: {
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: { status: true, permissions: true, lastError: true, lastSeenAt: true }
      }
    }
  });
  if (!chat) return null;

  const globalProfile = await getGlobalCaptchaProfile();
  const local = chat.captchaSettings;
  // A chat that never made an explicit choice follows the global profile —
  // see the matching fix in resolveEffectiveCaptchaSettings below.
  const useGlobalProfile = local?.useGlobalProfile ?? true;
  const effective = useGlobalProfile
    ? globalProfile.settings
    : serializeCaptchaSettings(local ?? DEFAULT_CAPTCHA_SETTINGS);
  const permissions = chat.botLinks[0]?.permissions as
    | { canRestrictMembers?: boolean }
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
      effectiveSource: useGlobalProfile ? ("GLOBAL" as const) : ("CHAT" as const),
      globalProfilePersisted: globalProfile.persisted
    },
    settings: serializeCaptchaSettings(local ?? DEFAULT_CAPTCHA_SETTINGS),
    effectiveSettings: serializeCaptchaSettings(effective),
    globalSettings: serializeCaptchaSettings(globalProfile.settings),
    bot: {
      status: chat.botLinks[0]?.status ?? "DISABLED",
      canRestrictMembers: Boolean(permissions?.canRestrictMembers),
      lastError: chat.botLinks[0]?.lastError ?? null,
      checkedAt: chat.botLinks[0]?.lastSeenAt?.toISOString() ?? null
    }
  };
}

export async function updateChatCaptchaProfile(input: {
  chatId: string;
  actingAdminId: string;
  useGlobalProfile: boolean;
  settings: CaptchaSettingsValue;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;
  const normalized = normalizeCaptchaSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatCaptchaSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, useGlobalProfile: input.useGlobalProfile, ...normalized },
      update: { useGlobalProfile: input.useGlobalProfile, ...normalized }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CAPTCHA_SETTINGS_UPDATED",
        metadata: {
          useGlobalProfile: settings.useGlobalProfile,
          ...serializeCaptchaSettings(settings)
        }
      }
    });
    return settings;
  });
  return {
    useGlobalProfile: saved.useGlobalProfile,
    ...serializeCaptchaSettings(saved)
  };
}

export async function resolveEffectiveCaptchaSettings(chatId: string) {
  const local = await prisma.chatCaptchaSettings.findUnique({ where: { chatId } });
  // A chat that never made an explicit choice follows the global profile —
  // otherwise a protective global policy would silently apply to no chat at
  // all until an admin opens every single chat and flips the toggle by hand.
  const useGlobalProfile = local?.useGlobalProfile ?? true;
  if (!useGlobalProfile) {
    return {
      source: "CHAT" as const,
      useGlobalProfile: false,
      settings: serializeCaptchaSettings(local ?? DEFAULT_CAPTCHA_SETTINGS)
    };
  }
  const global = await prisma.globalCaptchaSettings.findUnique({
    where: { id: GLOBAL_CAPTCHA_PROFILE_ID }
  });
  return {
    source: "GLOBAL" as const,
    useGlobalProfile: true,
    settings: serializeCaptchaSettings(global ?? DEFAULT_CAPTCHA_SETTINGS)
  };
}
