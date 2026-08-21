import { prisma } from "@/server/db/prisma";
import { getTelegramBotProfile, getTelegramClient } from "@/server/telegram/client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINK_WINDOW_MINUTES = 10;

export type LogChannelSettingsValue = {
  enabled: boolean;
  logChannelTelegramId: string | null;
  logChannelTitle: string | null;
};

function serialize(settings: {
  enabled: boolean;
  logChannelTelegramId: bigint | null;
  logChannelTitle: string | null;
}): LogChannelSettingsValue {
  return {
    enabled: settings.enabled,
    logChannelTelegramId: settings.logChannelTelegramId?.toString() ?? null,
    logChannelTitle: settings.logChannelTitle
  };
}

const DEFAULT_SETTINGS: LogChannelSettingsValue = { enabled: false, logChannelTelegramId: null, logChannelTitle: null };

export async function getChatLogChannelProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { logChannelSettings: true }
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
    settings: serialize(chat.logChannelSettings ?? DEFAULT_SETTINGS)
  };
}

export async function resolveEffectiveLogChannelSettings(chatId: string) {
  const local = await prisma.chatLogChannelSettings.findUnique({ where: { chatId } });
  return serialize(local ?? DEFAULT_SETTINGS);
}

export async function updateChatLogChannelSettings(input: {
  chatId: string;
  actingAdminId: string;
  enabled: boolean;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const existing = await prisma.chatLogChannelSettings.findUnique({ where: { chatId: input.chatId } });
  if (!existing?.logChannelTelegramId) return null;

  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatLogChannelSettings.update({
      where: { chatId: input.chatId },
      data: { enabled: input.enabled }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "LOG_CHANNEL_SETTINGS_UPDATED",
        metadata: { enabled: settings.enabled }
      }
    });
    return settings;
  });
  return serialize(saved);
}

export async function unlinkLogChannel(input: { chatId: string; actingAdminId: string }) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;

  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatLogChannelSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, enabled: false },
      update: { enabled: false, logChannelTelegramId: null, logChannelTitle: null, pendingLinkAdminId: null, pendingLinkExpiresAt: null }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "LOG_CHANNEL_UNLINKED"
      }
    });
    return settings;
  });
  return serialize(saved);
}

/** Opens a short-lived window during which a forwarded post from the target channel (in the admin's DM) completes the link -- see completePendingLogChannelLink. */
export async function startLogChannelLink(input: { chatId: string; actingAdminId: string }) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;

  await prisma.chatLogChannelSettings.upsert({
    where: { chatId: input.chatId },
    create: {
      chatId: input.chatId,
      pendingLinkAdminId: input.actingAdminId,
      pendingLinkExpiresAt: new Date(Date.now() + LINK_WINDOW_MINUTES * 60_000)
    },
    update: {
      pendingLinkAdminId: input.actingAdminId,
      pendingLinkExpiresAt: new Date(Date.now() + LINK_WINDOW_MINUTES * 60_000)
    }
  });
  return true;
}

async function findPendingLinkForAdmin(actingAdminId: string) {
  return prisma.chatLogChannelSettings.findFirst({
    where: { pendingLinkAdminId: actingAdminId, pendingLinkExpiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" },
    include: { chat: { select: { id: true, title: true } } }
  });
}

export type LogChannelLinkOutcome =
  | { outcome: "linked"; chatTitle: string; channelTitle: string }
  | { outcome: "no_pending_link" }
  | { outcome: "not_a_channel_forward" }
  | { outcome: "bot_not_in_channel" };

/**
 * Called from the admin's private chat when a forwarded message arrives.
 * Only MessageOriginChannel forwards carry the source chat's identity
 * reliably (a forwarded group message carries the original sender's
 * identity instead, per Bot API's MessageOrigin union) -- see the
 * forward_origin comment in telegram/types.ts.
 */
export async function completePendingLogChannelLink(input: {
  actingAdminId: string;
  forwardOrigin: { type: string; chat?: { id: number; title?: string; type: string } } | undefined;
}): Promise<LogChannelLinkOutcome> {
  const pending = await findPendingLinkForAdmin(input.actingAdminId);
  if (!pending) return { outcome: "no_pending_link" };

  if (input.forwardOrigin?.type !== "channel" || !input.forwardOrigin.chat) {
    return { outcome: "not_a_channel_forward" };
  }
  const channel = input.forwardOrigin.chat;

  try {
    const botProfile = await getTelegramBotProfile();
    const member = await getTelegramClient().getChatMember(channel.id, botProfile.id);
    if (member.status !== "administrator" && member.status !== "creator" && member.status !== "member") {
      return { outcome: "bot_not_in_channel" };
    }
  } catch {
    return { outcome: "bot_not_in_channel" };
  }

  const channelTitle = channel.title ?? String(channel.id);
  await prisma.$transaction(async (tx) => {
    await tx.chatLogChannelSettings.update({
      where: { chatId: pending.chatId },
      data: {
        enabled: true,
        logChannelTelegramId: BigInt(channel.id),
        logChannelTitle: channelTitle,
        pendingLinkAdminId: null,
        pendingLinkExpiresAt: null
      }
    });
    await tx.auditLog.create({
      data: {
        chatId: pending.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "LOG_CHANNEL_LINKED",
        metadata: { logChannelTelegramId: channel.id, logChannelTitle: channelTitle }
      }
    });
  });

  return { outcome: "linked", chatTitle: pending.chat.title, channelTitle };
}

const ACTION_LABELS: Record<string, string> = {
  WARNING: "⚠️ Предупреждение",
  MUTE: "🔇 Mute",
  UNMUTE: "🔊 Снятие mute",
  BAN: "⛔ Блокировка",
  UNBAN: "✅ Разблокировка",
  KICK: "👢 Исключение"
};

/** Best-effort, fire-and-forget -- see moderation-service.ts's call sites (recordWarning, executeTelegramBackedAction). */
export async function forwardModerationEventToLogChannel(input: {
  chatId: string;
  chatTitle: string;
  action: keyof typeof ACTION_LABELS;
  targetDisplayName: string;
  reason: string | null;
}) {
  try {
    const settings = await resolveEffectiveLogChannelSettings(input.chatId);
    if (!settings.enabled || !settings.logChannelTelegramId) return;

    const label = ACTION_LABELS[input.action] ?? input.action;
    const lines = [
      `${label} — «${input.chatTitle}»`,
      `Участник: ${input.targetDisplayName}`,
      input.reason ? `Причина: ${input.reason}` : null
    ].filter(Boolean);

    await getTelegramClient().sendMessage({
      chatId: Number(settings.logChannelTelegramId),
      text: lines.join("\n")
    });
  } catch {
    // Best-effort: the channel may have been deleted, the bot demoted, etc.
    // -- must never block the underlying moderation action.
  }
}
