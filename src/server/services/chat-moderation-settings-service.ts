import { prisma } from "@/server/db/prisma";
import {
  normalizeAllowedDomains,
  normalizeBlockedTerms
} from "@/server/services/automod-service";
import {
  DEFAULT_MODERATION_SETTINGS,
  isLinkProtectionMode,
  normalizeEscalationRules,
  normalizeModerationSettings,
  normalizeMediaFilters,
  resolveEffectiveModerationSettings,
  serializeModerationSettings
} from "@/server/services/global-moderation-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getChatModerationProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
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

  const [events, effective] = await Promise.all([
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
            "AUTOMOD_LINK_TRIGGERED",
            "AUTOMOD_TERM_TRIGGERED",
            "AUTOMOD_MEDIA_TRIGGERED",
            "AUTOMOD_MENTIONS_TRIGGERED",
            "AUTOMOD_DUPLICATE_TRIGGERED",
            "AUTOMOD_SPAM_TRIGGERED",
            "AUTOMOD_DELETE_FAILED",
            "AUTOMOD_WARNING",
            "AUTOMOD_AUTO_MUTE",
            "AUTOMOD_AUTO_BAN",
            "AUTOMOD_ESCALATION_FAILED",
            "AUTOMOD_SETTINGS_UPDATED",
            "CAPTCHA_CHALLENGE_SENT",
            "CAPTCHA_PASSED",
            "CAPTCHA_TIMEOUT_KICK",
            "CAPTCHA_SETTINGS_UPDATED",
            "NEW_MEMBER_BLOCKED",
            "NEW_MEMBER_MUTED",
            "EXISTING_MEMBER_BLOCKED"
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
    resolveEffectiveModerationSettings(chatId)
  ]);

  const link = chat.botLinks[0];
  const permissions = link?.permissions as
    | { canDeleteMessages?: boolean; canRestrictMembers?: boolean }
    | null
    | undefined;

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
    settings: effective.settings,
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
  linkEnabled: boolean;
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
  ignoreAdmins: boolean;
  autoEscalationEnabled: boolean;
  escalationRules: unknown;
  warningExpiryDays: number;
  announceEscalationEnabled: boolean;
  escalationMuteMessageTemplate: string;
  escalationBanMessageTemplate: string;
  mediaFilters: unknown;
  ruleActions: unknown;
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
  const warningExpiryDays = Math.min(3650, Math.max(0, Math.trunc(input.warningExpiryDays)));
  const escalationMuteMessageTemplate = input.escalationMuteMessageTemplate.trim().slice(0, 1000) || DEFAULT_MODERATION_SETTINGS.escalationMuteMessageTemplate;
  const escalationBanMessageTemplate = input.escalationBanMessageTemplate.trim().slice(0, 1000) || DEFAULT_MODERATION_SETTINGS.escalationBanMessageTemplate;
  const values = normalizeModerationSettings({
    linkEnabled: input.linkEnabled,
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
    ignoreAdmins: input.ignoreAdmins,
    autoEscalationEnabled: input.autoEscalationEnabled,
    escalationRules: normalizeEscalationRules(input.escalationRules),
    warningExpiryDays,
    announceEscalationEnabled: input.announceEscalationEnabled,
    escalationMuteMessageTemplate,
    escalationBanMessageTemplate,
    mediaFilters: normalizeMediaFilters(input.mediaFilters),
    ruleActions: input.ruleActions
  });

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
        metadata: serializeModerationSettings(settings)
      }
    });

    return settings;
  });

  return serializeModerationSettings(saved);
}
