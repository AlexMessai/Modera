import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_MODERATION_SETTINGS,
  serializeModerationSettings
} from "@/server/services/global-moderation-service";

const AUTOMOD_ACTIONS = [
  "AUTOMOD_LINK_DELETED",
  "AUTOMOD_TERM_DELETED",
  "AUTOMOD_MEDIA_DELETED",
  "AUTOMOD_MENTIONS_DELETED",
  "AUTOMOD_DUPLICATE_DELETED",
  "AUTOMOD_SPAM_DELETED",
  "AUTOMOD_WARNING",
  "AUTOMOD_AUTO_MUTE",
  "AUTOMOD_AUTO_BAN"
];

function enabledRules(settings: {
  blockLinks: boolean;
  spamEnabled: boolean;
  blockedTermsEnabled: boolean;
  massMentionsEnabled: boolean;
  duplicateEnabled: boolean;
  blockedMessageTypes: string[];
  autoEscalationEnabled: boolean;
} | null) {
  if (!settings) return [];
  const rules: string[] = [];
  if (settings.blockLinks) rules.push("LINKS");
  if (settings.blockedTermsEnabled) rules.push("TERMS");
  if (settings.spamEnabled) rules.push("FLOOD");
  if (settings.duplicateEnabled) rules.push("DUPLICATES");
  if (settings.massMentionsEnabled) rules.push("MENTIONS");
  if (settings.blockedMessageTypes.length > 0) rules.push("MEDIA");
  if (settings.autoEscalationEnabled) rules.push("PUNISHMENTS");
  return rules;
}

export async function getModerationDashboard() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [chats, globalStored, automod24h, errors24h] = await Promise.all([
    prisma.chat.findMany({
      orderBy: { lastActivityAt: "desc" },
      take: 200,
      include: {
        moderationSettings: true,
        botLinks: {
          orderBy: { lastSeenAt: "desc" },
          take: 1,
          select: { status: true, permissions: true, lastError: true, lastSeenAt: true }
        }
      }
    }),
    prisma.globalModerationSettings.findUnique({ where: { id: "global" } }),
    prisma.auditLog.count({ where: { action: { in: AUTOMOD_ACTIONS }, createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: { in: ["AUTOMOD_DELETE_FAILED", "AUTOMOD_ESCALATION_FAILED"] }, createdAt: { gte: since } } })
  ]);

  const globalSettings = globalStored ?? DEFAULT_MODERATION_SETTINGS;
  const items = chats.map((chat) => {
    const link = chat.botLinks[0];
    const permissions = link?.permissions as { canDeleteMessages?: boolean; canRestrictMembers?: boolean } | null | undefined;
    // A chat with no row at all follows the global profile — matches
    // resolveEffectiveModerationSettings in global-moderation-service.ts.
    const useGlobalProfile = chat.moderationSettings?.useGlobalProfile ?? true;
    const effectiveSettings = useGlobalProfile ? globalSettings : (chat.moderationSettings ?? DEFAULT_MODERATION_SETTINGS);
    const rules = enabledRules(effectiveSettings);

    return {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type,
      lastActivityAt: chat.lastActivityAt.toISOString(),
      botStatus: link?.status ?? "DISABLED",
      canDeleteMessages: Boolean(permissions?.canDeleteMessages),
      canRestrictMembers: Boolean(permissions?.canRestrictMembers),
      autoEscalationEnabled: Boolean(effectiveSettings?.autoEscalationEnabled),
      lastError: link?.lastError ?? null,
      policySource: useGlobalProfile ? "GLOBAL" as const : "CHAT" as const,
      rules
    };
  });

  return {
    metrics: {
      totalChats: items.length,
      configuredChats: items.filter((item) => item.rules.length > 0).length,
      inheritedChats: items.filter((item) => item.policySource === "GLOBAL").length,
      chatsWithoutDeletePermission: items.filter((item) => item.rules.some((rule) => rule !== "PUNISHMENTS") && !item.canDeleteMessages).length,
      escalationWithoutRestrictPermission: items.filter((item) => item.autoEscalationEnabled && !item.canRestrictMembers).length,
      automod24h,
      errors24h
    },
    globalProfile: {
      persisted: Boolean(globalStored),
      settings: serializeModerationSettings(globalSettings)
    },
    chats: items
  };
}
