import { prisma } from "@/server/db/prisma";

const AUTOMOD_ACTIONS = [
  "AUTOMOD_LINK_DELETED",
  "AUTOMOD_TERM_DELETED",
  "AUTOMOD_MEDIA_DELETED",
  "AUTOMOD_MENTIONS_DELETED",
  "AUTOMOD_DUPLICATE_DELETED",
  "AUTOMOD_SPAM_DELETED"
];

function enabledRules(settings: {
  blockLinks: boolean;
  spamEnabled: boolean;
  blockedTermsEnabled: boolean;
  massMentionsEnabled: boolean;
  duplicateEnabled: boolean;
  blockedMessageTypes: string[];
} | null) {
  if (!settings) return [];
  const rules: string[] = [];
  if (settings.blockLinks) rules.push("LINKS");
  if (settings.blockedTermsEnabled) rules.push("TERMS");
  if (settings.spamEnabled) rules.push("FLOOD");
  if (settings.duplicateEnabled) rules.push("DUPLICATES");
  if (settings.massMentionsEnabled) rules.push("MENTIONS");
  if (settings.blockedMessageTypes.length > 0) rules.push("MEDIA");
  return rules;
}

export async function getModerationDashboard() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [chats, automod24h, errors24h] = await prisma.$transaction([
    prisma.chat.findMany({
      orderBy: { lastActivityAt: "desc" },
      take: 200,
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
    }),
    prisma.auditLog.count({
      where: {
        action: { in: AUTOMOD_ACTIONS },
        createdAt: { gte: since }
      }
    }),
    prisma.auditLog.count({
      where: {
        action: "AUTOMOD_DELETE_FAILED",
        createdAt: { gte: since }
      }
    })
  ]);

  const items = chats.map((chat) => {
    const link = chat.botLinks[0];
    const permissions = link?.permissions as
      | { canDeleteMessages?: boolean; canRestrictMembers?: boolean }
      | null
      | undefined;
    const rules = enabledRules(chat.moderationSettings);
    return {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type,
      lastActivityAt: chat.lastActivityAt.toISOString(),
      botStatus: link?.status ?? "DISABLED",
      canDeleteMessages: Boolean(permissions?.canDeleteMessages),
      lastError: link?.lastError ?? null,
      rules
    };
  });

  return {
    metrics: {
      totalChats: items.length,
      configuredChats: items.filter((item) => item.rules.length > 0).length,
      chatsWithoutDeletePermission: items.filter(
        (item) => item.rules.length > 0 && !item.canDeleteMessages
      ).length,
      automod24h,
      errors24h
    },
    chats: items
  };
}
