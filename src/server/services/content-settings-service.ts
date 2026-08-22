import { prisma } from "@/server/db/prisma";

export type ContentSettingsValue = {
  welcomeEnabled: boolean;
  welcomeMessageTemplate: string;
  rulesText: string;
};

export const DEFAULT_CONTENT_SETTINGS: ContentSettingsValue = {
  welcomeEnabled: false,
  welcomeMessageTemplate: "Добро пожаловать, {name}! 👋\n\nЧат «{group}» рад видеть вас — сейчас в нём {member_count} участников.",
  rulesText: ""
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTemplate(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2000) : fallback;
}

export function normalizeContentSettings(input: ContentSettingsValue): ContentSettingsValue {
  return {
    welcomeEnabled: Boolean(input.welcomeEnabled),
    welcomeMessageTemplate: normalizeTemplate(input.welcomeMessageTemplate, DEFAULT_CONTENT_SETTINGS.welcomeMessageTemplate),
    rulesText: input.rulesText.trim().slice(0, 4000)
  };
}

export function serializeContentSettings(settings: ContentSettingsValue): ContentSettingsValue {
  return {
    welcomeEnabled: settings.welcomeEnabled,
    welcomeMessageTemplate: settings.welcomeMessageTemplate,
    rulesText: settings.rulesText
  };
}

/** §30's fixed placeholder vocabulary -- curly braces, matching the spec exactly (every other template in this codebase uses %percent% instead, but Welcome is specified this way). */
export function renderWelcomeTemplate(template: string, values: { name: string; username: string; group: string; memberCount: string }) {
  return template
    .replaceAll("{name}", values.name)
    .replaceAll("{username}", values.username)
    .replaceAll("{group}", values.group)
    .replaceAll("{member_count}", values.memberCount);
}

export async function getChatContentProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) return null;

  const effective = await resolveEffectiveContentSettings(chatId);

  return {
    chat: {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type
    },
    settings: effective.settings
  };
}

export async function updateChatContentSettings(input: {
  chatId: string;
  actingAdminId: string;
  settings: ContentSettingsValue;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;
  const normalized = normalizeContentSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatContentSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, ...normalized },
      update: normalized
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CONTENT_SETTINGS_UPDATED",
        metadata: serializeContentSettings(settings)
      }
    });
    return settings;
  });
  return serializeContentSettings(saved);
}

const GLOBAL_CONTENT_MESSAGES_ID = "global";

/**
 * The welcome text is edited in one place -- Система → Уведомления, see
 * system-messages-service.ts -- not per chat; `welcomeEnabled`/`rulesText` stay chat-owned
 * (rulesText is each chat's own /rules content, not a system notification). Overlaying instead of
 * a hard split keeps this function's return shape unchanged, so every runtime caller
 * (welcome-service.ts) needed no changes.
 */
async function overlayGlobalContentText(settings: ContentSettingsValue): Promise<ContentSettingsValue> {
  const global = await prisma.globalContentSettings.findUnique({
    where: { id: GLOBAL_CONTENT_MESSAGES_ID },
    select: { welcomeMessageTemplate: true }
  });
  return {
    ...settings,
    welcomeMessageTemplate: global?.welcomeMessageTemplate ?? DEFAULT_CONTENT_SETTINGS.welcomeMessageTemplate
  };
}

export async function resolveEffectiveContentSettings(chatId: string) {
  const local = await prisma.chatContentSettings.findUnique({ where: { chatId } });
  const settings = await overlayGlobalContentText(serializeContentSettings(local ?? DEFAULT_CONTENT_SETTINGS));
  return {
    source: "CHAT" as const,
    useGlobalProfile: false,
    settings
  };
}
