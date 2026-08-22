import { prisma } from "@/server/db/prisma";
import {
  normalizeAllowedDomains,
  normalizeBlockedTerms,
  RESTRICTABLE_MESSAGE_TYPES,
  type RestrictableMessageType
} from "@/server/services/automod-service";
import {
  DEFAULT_MODERATION_SETTINGS,
  getGlobalModerationProfile,
  isLinkProtectionMode,
  normalizeEscalationRules,
  normalizeMediaFilters,
  resolveEffectiveModerationSettings,
  serializeModerationSettings
} from "@/server/services/global-moderation-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_CHAT_MODERATION_SETTINGS = DEFAULT_MODERATION_SETTINGS;

function normalizeBlockedMessageTypes(values: string[]) {
  const allowed = new Set<string>(RESTRICTABLE_MESSAGE_TYPES);
  return Array.from(new Set(values.filter((value) => allowed.has(value)))).slice(0, 20) as RestrictableMessageType[];
}

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

  const [events, effective, globalProfile] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        chatId,
        action: {
          in: [
            "AUTOMOD_LINK_DELETED",
            "AUTOMOD_SPAM_DELETED",
            "AUTOMOD_TERM_DELETED",
            "AUTOMOD_MEDIA_DELETED",
            "AUTOMOD_MENTIONS_DELETED",
            "AUTOMOD_DUPLICATE_DELETED",
            "AUTOMOD_DELETE_FAILED",
            "AUTOMOD_WARNING",
            "AUTOMOD_AUTO_MUTE",
            "AUTOMOD_AUTO_BAN",
            "AUTOMOD_ESCALATION_FAILED",
            "AUTOMOD_SETTINGS_UPDATED",
            "CAPTCHA_CHALLENGE_SENT",
            "CAPTCHA_PASSED",
            "CAPTCHA_TIMEOUT_KICK",
            "CAPTCHA_TIMEOUT_BAN",
            "CAPTCHA_SETTINGS_UPDATED"
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
    }),
    resolveEffectiveModerationSettings(chatId),
    getGlobalModerationProfile()
  ]);

  const link = chat.botLinks[0];
  const permissions = link?.permissions as
    | { canDeleteMessages?: boolean; canRestrictMembers?: boolean }
    | null
    | undefined;
  const localSettings = chat.moderationSettings ?? DEFAULT_CHAT_MODERATION_SETTINGS;

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
    policy: {
      useGlobalProfile: chat.moderationSettings?.useGlobalProfile ?? true,
      effectiveSource: effective.source,
      globalProfilePersisted: globalProfile.persisted
    },
    settings: serializeModerationSettings(localSettings),
    effectiveSettings: serializeModerationSettings(effective.settings),
    globalSettings: serializeModerationSettings(globalProfile.settings),
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
  useGlobalProfile: boolean;
  linkProtectionMode: string;
  allowedDomains: string[];
  blockedDomains: string[];
  spamEnabled: boolean;
  spamWindowSeconds: number;
  spamMaxMessages: number;
  blockedTermsEnabled: boolean;
  blockedTerms: string[];
  massMentionsEnabled: boolean;
  maxMentions: number;
  duplicateEnabled: boolean;
  duplicateWindowSeconds: number;
  duplicateMaxMessages: number;
  blockedMessageTypes: string[];
  ignoreAdmins: boolean;
  autoEscalationEnabled: boolean;
  escalationRules: unknown;
  warningExpiryDays: number;
  announceEscalationEnabled: boolean;
  escalationMuteMessageTemplate: string;
  escalationBanMessageTemplate: string;
  mediaFilters: unknown;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;

  const chat = await prisma.chat.findUnique({
    where: { id: input.chatId },
    select: { id: true }
  });
  if (!chat) return null;

  const allowedDomains = normalizeAllowedDomains(input.allowedDomains);
  const blockedDomains = normalizeAllowedDomains(input.blockedDomains);
  const linkProtectionMode = isLinkProtectionMode(input.linkProtectionMode) ? input.linkProtectionMode : "ALLOW_ALL";
  const blockedTerms = normalizeBlockedTerms(input.blockedTerms);
  const blockedMessageTypes = normalizeBlockedMessageTypes(input.blockedMessageTypes);
  const warningExpiryDays = Math.min(3650, Math.max(0, Math.trunc(input.warningExpiryDays)));
  const escalationMuteMessageTemplate = input.escalationMuteMessageTemplate.trim().slice(0, 1000) || DEFAULT_MODERATION_SETTINGS.escalationMuteMessageTemplate;
  const escalationBanMessageTemplate = input.escalationBanMessageTemplate.trim().slice(0, 1000) || DEFAULT_MODERATION_SETTINGS.escalationBanMessageTemplate;
  const values = {
    useGlobalProfile: input.useGlobalProfile,
    linkProtectionMode,
    allowedDomains,
    blockedDomains,
    spamEnabled: input.spamEnabled,
    spamWindowSeconds: input.spamWindowSeconds,
    spamMaxMessages: input.spamMaxMessages,
    blockedTermsEnabled: input.blockedTermsEnabled,
    blockedTerms,
    massMentionsEnabled: input.massMentionsEnabled,
    maxMentions: input.maxMentions,
    duplicateEnabled: input.duplicateEnabled,
    duplicateWindowSeconds: input.duplicateWindowSeconds,
    duplicateMaxMessages: input.duplicateMaxMessages,
    blockedMessageTypes,
    ignoreAdmins: input.ignoreAdmins,
    autoEscalationEnabled: input.autoEscalationEnabled,
    escalationRules: normalizeEscalationRules(input.escalationRules),
    warningExpiryDays,
    announceEscalationEnabled: input.announceEscalationEnabled,
    escalationMuteMessageTemplate,
    escalationBanMessageTemplate,
    mediaFilters: normalizeMediaFilters(input.mediaFilters)
  };

  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatModerationSettings.upsert({
      where: { chatId: input.chatId },
      create: {
        chatId: input.chatId,
        ...values
      },
      update: values
    });

    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "AUTOMOD_SETTINGS_UPDATED",
        metadata: {
          useGlobalProfile: settings.useGlobalProfile,
          ...serializeModerationSettings(settings)
        }
      }
    });

    return settings;
  });

  return {
    useGlobalProfile: saved.useGlobalProfile,
    ...serializeModerationSettings(saved)
  };
}