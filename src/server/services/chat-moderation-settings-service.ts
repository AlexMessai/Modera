import { prisma } from "@/server/db/prisma";
import { normalizeAllowedDomains } from "@/server/services/automod-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_CHAT_MODERATION_SETTINGS = {
  blockLinks: false,
  allowedDomains: [] as string[],
  spamEnabled: false,
  spamWindowSeconds: 10,
  spamMaxMessages: 5,
  ignoreAdmins: true
};

export async function getChatModerationProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      moderationSettings: true,
      botLinks: {
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: {
          status: true,
          permissions: true,
          lastError: true,
          lastSeenAt: true
        }
      }
    }
  });

  if (!chat) return null;

  const events = await prisma.auditLog.findMany({
    where: {
      chatId,
      action: {
        in: [
          "AUTOMOD_LINK_DELETED",
          "AUTOMOD_SPAM_DELETED",
          "AUTOMOD_DELETE_FAILED",
          "AUTOMOD_SETTINGS_UPDATED"
        ]
      }
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      affectedUser: {
        select: {
          displayName: true,
          username: true
        }
      },
      actingAdmin: {
        select: {
          displayName: true
        }
      }
    }
  });

  const link = chat.botLinks[0];
  const permissions = link?.permissions as
    | { canDeleteMessages?: boolean; canRestrictMembers?: boolean }
    | null
    | undefined;
  const settings = chat.moderationSettings ?? DEFAULT_CHAT_MODERATION_SETTINGS;

  return {
    chat: {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type,
      knownMemberCount: chat.knownMemberCount,
      lastActivityAt: chat.lastActivityAt.toISOString()
    },
    bot: {
      status: link?.status ?? "DISABLED",
      canDeleteMessages: Boolean(permissions?.canDeleteMessages),
      canRestrictMembers: Boolean(permissions?.canRestrictMembers),
      lastError: link?.lastError ?? null,
      checkedAt: link?.lastSeenAt?.toISOString() ?? null
    },
    settings: {
      blockLinks: settings.blockLinks,
      allowedDomains: [...settings.allowedDomains],
      spamEnabled: settings.spamEnabled,
      spamWindowSeconds: settings.spamWindowSeconds,
      spamMaxMessages: settings.spamMaxMessages,
      ignoreAdmins: settings.ignoreAdmins
    },
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      reason: event.reason,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
      affectedUser: event.affectedUser,
      actingAdmin: event.actingAdmin
    }))
  };
}

export async function updateChatModerationSettings(input: {
  chatId: string;
  actingAdminId: string;
  blockLinks: boolean;
  allowedDomains: string[];
  spamEnabled: boolean;
  spamWindowSeconds: number;
  spamMaxMessages: number;
  ignoreAdmins: boolean;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;

  const chat = await prisma.chat.findUnique({
    where: { id: input.chatId },
    select: { id: true }
  });
  if (!chat) return null;

  const allowedDomains = normalizeAllowedDomains(input.allowedDomains);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatModerationSettings.upsert({
      where: { chatId: input.chatId },
      create: {
        chatId: input.chatId,
        blockLinks: input.blockLinks,
        allowedDomains,
        spamEnabled: input.spamEnabled,
        spamWindowSeconds: input.spamWindowSeconds,
        spamMaxMessages: input.spamMaxMessages,
        ignoreAdmins: input.ignoreAdmins
      },
      update: {
        blockLinks: input.blockLinks,
        allowedDomains,
        spamEnabled: input.spamEnabled,
        spamWindowSeconds: input.spamWindowSeconds,
        spamMaxMessages: input.spamMaxMessages,
        ignoreAdmins: input.ignoreAdmins
      }
    });

    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "AUTOMOD_SETTINGS_UPDATED",
        metadata: {
          blockLinks: settings.blockLinks,
          allowedDomains: settings.allowedDomains,
          spamEnabled: settings.spamEnabled,
          spamWindowSeconds: settings.spamWindowSeconds,
          spamMaxMessages: settings.spamMaxMessages,
          ignoreAdmins: settings.ignoreAdmins
        }
      }
    });

    return settings;
  });

  return {
    blockLinks: saved.blockLinks,
    allowedDomains: saved.allowedDomains,
    spamEnabled: saved.spamEnabled,
    spamWindowSeconds: saved.spamWindowSeconds,
    spamMaxMessages: saved.spamMaxMessages,
    ignoreAdmins: saved.ignoreAdmins
  };
}
