import { prisma } from "@/server/db/prisma";

// Fixed rule, not configurable: mute on join, kick (never ban) whoever is
// still unverified at the next daily sweep -- no per-chat/global timeout or
// kick-vs-ban choice anymore. challengeMessageTemplate is the ephemeral
// "Я не бот" prompt text -- no placeholders, it's shown only to the joining
// member so there's nothing to interpolate.
export type CaptchaSettingsValue = {
  enabled: boolean;
  challengeMessageTemplate: string;
  challengeButtonText: string;
  deleteAfterVerification: boolean;
};

export const DEFAULT_CAPTCHA_SETTINGS: CaptchaSettingsValue = {
  enabled: false,
  challengeMessageTemplate: "Подтвердите, что вы не бот — нажмите кнопку ниже. Пока не подтвердите, вы не сможете писать в этом чате; если долго не подтвердите, вас исключат (без блокировки — сможете зайти снова).",
  challengeButtonText: "✅ Я не бот",
  deleteAfterVerification: true
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTemplate(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1000) : fallback;
}

export function normalizeCaptchaSettings(input: CaptchaSettingsValue): CaptchaSettingsValue {
  return {
    enabled: Boolean(input.enabled),
    challengeMessageTemplate: normalizeTemplate(input.challengeMessageTemplate, DEFAULT_CAPTCHA_SETTINGS.challengeMessageTemplate),
    challengeButtonText: normalizeTemplate(input.challengeButtonText, DEFAULT_CAPTCHA_SETTINGS.challengeButtonText).slice(0, 64),
    deleteAfterVerification: Boolean(input.deleteAfterVerification)
  };
}

export function serializeCaptchaSettings(settings: CaptchaSettingsValue): CaptchaSettingsValue {
  return {
    enabled: settings.enabled,
    challengeMessageTemplate: settings.challengeMessageTemplate,
    challengeButtonText: settings.challengeButtonText,
    deleteAfterVerification: settings.deleteAfterVerification
  };
}

export async function getChatCaptchaProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      botLinks: {
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: { status: true, permissions: true, lastError: true, lastSeenAt: true }
      }
    }
  });
  if (!chat) return null;

  const permissions = chat.botLinks[0]?.permissions as
    | { canRestrictMembers?: boolean }
    | null
    | undefined;
  const effective = await resolveEffectiveCaptchaSettings(chatId);

  return {
    chat: {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type
    },
    settings: effective.settings,
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
  settings: CaptchaSettingsValue;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;
  const normalized = normalizeCaptchaSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatCaptchaSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, ...normalized },
      update: normalized
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CAPTCHA_SETTINGS_UPDATED",
        metadata: serializeCaptchaSettings(settings)
      }
    });
    return settings;
  });
  return serializeCaptchaSettings(saved);
}

export async function resolveEffectiveCaptchaSettings(chatId: string) {
  const local = await prisma.chatCaptchaSettings.findUnique({ where: { chatId } });
  const settings = serializeCaptchaSettings(local ?? DEFAULT_CAPTCHA_SETTINGS);
  return {
    source: "CHAT" as const,
    settings
  };
}
