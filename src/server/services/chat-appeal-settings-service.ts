import { prisma } from "@/server/db/prisma";

// Per-chat /appeal toggle + notification flags. Deliberately a simple
// per-chat table without a Global+useGlobalProfile split (same shape as
// ChatAdminAccess/chat-role-service.ts, not captcha/manual-moderation's
// inheritance pattern) -- appeals were never chat-configurable before this
// feature existed, so there is no meaningful "global profile" to inherit
// from; every chat just gets its own row, defaulting to fully on.
export type ChatAppealSettingsValue = {
  enabled: boolean;
  notifyAdminsOnSubmit: boolean;
  notifyUserOnDecision: boolean;
};

// All default true so an existing chat's behavior doesn't silently change
// the moment this table is introduced -- no row yet means "on", same as
// before this feature existed.
export const DEFAULT_CHAT_APPEAL_SETTINGS: ChatAppealSettingsValue = {
  enabled: true,
  notifyAdminsOnSubmit: true,
  notifyUserOnDecision: true
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeChatAppealSettings(input: ChatAppealSettingsValue): ChatAppealSettingsValue {
  return {
    enabled: Boolean(input.enabled),
    notifyAdminsOnSubmit: Boolean(input.notifyAdminsOnSubmit),
    notifyUserOnDecision: Boolean(input.notifyUserOnDecision)
  };
}

export function serializeChatAppealSettings(settings: ChatAppealSettingsValue): ChatAppealSettingsValue {
  return {
    enabled: settings.enabled,
    notifyAdminsOnSubmit: settings.notifyAdminsOnSubmit,
    notifyUserOnDecision: settings.notifyUserOnDecision
  };
}

export async function getChatAppealProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { appealSettings: true }
  });
  if (!chat) return null;

  return {
    chat: {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type
    },
    settings: serializeChatAppealSettings(chat.appealSettings ?? DEFAULT_CHAT_APPEAL_SETTINGS)
  };
}

export async function updateChatAppealProfile(input: {
  chatId: string;
  actingAdminId: string;
  settings: ChatAppealSettingsValue;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;
  const normalized = normalizeChatAppealSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatAppealSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, ...normalized },
      update: normalized
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "APPEAL_SETTINGS_UPDATED",
        metadata: serializeChatAppealSettings(settings)
      }
    });
    return settings;
  });
  return serializeChatAppealSettings(saved);
}

export async function resolveEffectiveChatAppealSettings(chatId: string) {
  const local = await prisma.chatAppealSettings.findUnique({ where: { chatId } });
  return {
    source: "CHAT" as const,
    settings: serializeChatAppealSettings(local ?? DEFAULT_CHAT_APPEAL_SETTINGS)
  };
}
