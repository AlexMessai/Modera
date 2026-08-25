import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { escapeTelegramHtml } from "@/server/telegram/formatted-text";

export type WelcomeButtonValue = { text: string; url: string };

export type ContentSettingsValue = {
  welcomeEnabled: boolean;
  welcomeMessageTemplate: string;
  welcomeButtons: WelcomeButtonValue[];
  muteNewMembersMinutes: number;
  blockRtlNames: boolean;
  blockChatFolderJoins: boolean;
  blockInvitedBots: boolean;
  blockMissingUsername: boolean;
  maxNameLength: number;
  blockedNamePatterns: string[];
  checkExistingMembers: boolean;
};

export const DEFAULT_CONTENT_SETTINGS: ContentSettingsValue = {
  welcomeEnabled: false,
  welcomeMessageTemplate: "Добро пожаловать, {name}! 👋\n\nЧат «{group}» рад видеть вас — сейчас в нём {member_count} участников.",
  welcomeButtons: [],
  muteNewMembersMinutes: 0,
  blockRtlNames: false,
  blockChatFolderJoins: false,
  blockInvitedBots: false,
  blockMissingUsername: false,
  maxNameLength: 0,
  blockedNamePatterns: [],
  checkExistingMembers: false
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTemplate(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2000) : fallback;
}

function normalizeButtons(value: unknown): WelcomeButtonValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const text = "text" in candidate && typeof candidate.text === "string" ? candidate.text.trim().slice(0, 64) : "";
    const url = "url" in candidate && typeof candidate.url === "string" ? candidate.url.trim().slice(0, 500) : "";
    if (!text || !/^https?:\/\//i.test(url)) return [];
    return [{ text, url }];
  }).slice(0, 8);
}

export function normalizeContentSettings(input: ContentSettingsValue): ContentSettingsValue {
  return {
    welcomeEnabled: Boolean(input.welcomeEnabled),
    welcomeMessageTemplate: normalizeTemplate(input.welcomeMessageTemplate, DEFAULT_CONTENT_SETTINGS.welcomeMessageTemplate),
    welcomeButtons: normalizeButtons(input.welcomeButtons),
    muteNewMembersMinutes: Math.min(10080, Math.max(0, Math.trunc(Number(input.muteNewMembersMinutes) || 0))),
    blockRtlNames: Boolean(input.blockRtlNames),
    blockChatFolderJoins: Boolean(input.blockChatFolderJoins),
    blockInvitedBots: Boolean(input.blockInvitedBots),
    blockMissingUsername: Boolean(input.blockMissingUsername),
    maxNameLength: Math.min(256, Math.max(0, Math.trunc(Number(input.maxNameLength) || 0))),
    blockedNamePatterns: input.blockedNamePatterns.map((value) => value.trim()).filter(Boolean).slice(0, 100),
    checkExistingMembers: Boolean(input.checkExistingMembers)
  };
}

export function serializeContentSettings(settings: Omit<ContentSettingsValue, "welcomeButtons"> & { welcomeButtons: unknown }): ContentSettingsValue {
  return normalizeContentSettings({ ...settings, welcomeButtons: normalizeButtons(settings.welcomeButtons) });
}

/** §30's fixed placeholder vocabulary -- curly braces, matching the spec exactly (every other template in this codebase uses %percent% instead, but Welcome is specified this way). */
export function renderWelcomeTemplate(template: string, values: { name: string; username: string; group: string; memberCount: string }) {
  return template
    .replaceAll("{name}", escapeTelegramHtml(values.name))
    .replaceAll("{username}", escapeTelegramHtml(values.username))
    .replaceAll("{group}", escapeTelegramHtml(values.group))
    .replaceAll("{member_count}", escapeTelegramHtml(values.memberCount));
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
      create: { chatId: input.chatId, ...normalized, welcomeButtons: normalized.welcomeButtons as Prisma.InputJsonValue },
      update: { ...normalized, welcomeButtons: normalized.welcomeButtons as Prisma.InputJsonValue }
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
  if (normalized.checkExistingMembers) {
    const { reviewExistingMembers } = await import("@/server/services/new-member-protection-service");
    await reviewExistingMembers(input.chatId).catch(() => undefined);
  }
  return serializeContentSettings(saved);
}

export async function resolveEffectiveContentSettings(chatId: string) {
  const local = await prisma.chatContentSettings.findUnique({ where: { chatId } });
  const settings = serializeContentSettings(local ?? DEFAULT_CONTENT_SETTINGS);
  return {
    source: "CHAT" as const,
    settings
  };
}
