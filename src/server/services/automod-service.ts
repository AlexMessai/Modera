import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  findEnabledMediaFilterRule,
  resolveEffectiveModerationSettings,
  type LinkProtectionMode
} from "@/server/services/global-moderation-service";
import {
  getTelegramClient,
  TelegramApiError
} from "@/server/telegram/client";
import type {
  TelegramMessage,
  TelegramMessageEntity
} from "@/server/telegram/types";

const CLAIM_STALE_MS = 2 * 60 * 1000;
const PROTECTED_STATUSES = new Set(["CREATOR", "ADMINISTRATOR"]);
const URL_FALLBACK_PATTERN = /(?<![@\w])(?:(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s<>"']*)?)/giu;

export const RESTRICTABLE_MESSAGE_TYPES = [
  "PHOTO",
  "VIDEO",
  "ANIMATION",
  "DOCUMENT",
  "STICKER",
  "VOICE",
  "AUDIO",
  "VIDEO_NOTE",
  "POLL",
  "DICE",
  "LOCATION",
  "CONTACT"
] as const;

export type RestrictableMessageType = (typeof RESTRICTABLE_MESSAGE_TYPES)[number];

export type AutomodRule =
  | "LINK"
  | "TERM"
  | "MEDIA"
  | "MENTIONS"
  | "DUPLICATE"
  | "SPAM";

const RESULT_BY_RULE: Record<AutomodRule, string> = {
  LINK: "DELETED_LINK",
  TERM: "DELETED_TERM",
  MEDIA: "DELETED_MEDIA",
  MENTIONS: "DELETED_MENTIONS",
  DUPLICATE: "DELETED_DUPLICATE",
  SPAM: "DELETED_SPAM"
};

const AUDIT_BY_RULE: Record<AutomodRule, string> = {
  LINK: "AUTOMOD_LINK_DELETED",
  TERM: "AUTOMOD_TERM_DELETED",
  MEDIA: "AUTOMOD_MEDIA_DELETED",
  MENTIONS: "AUTOMOD_MENTIONS_DELETED",
  DUPLICATE: "AUTOMOD_DUPLICATE_DELETED",
  SPAM: "AUTOMOD_SPAM_DELETED"
};

const REASON_BY_RULE: Record<AutomodRule, string> = {
  LINK: "Автомодерация: запрещённая ссылка",
  TERM: "Автомодерация: запрещённое слово или фраза",
  MEDIA: "Автомодерация: запрещённый тип контента",
  MENTIONS: "Автомодерация: слишком много упоминаний",
  DUPLICATE: "Автомодерация: повторяющееся сообщение",
  SPAM: "Автомодерация: превышен лимит сообщений"
};

export function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/^\.+/, "");
  if (!trimmed) return null;

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return hostname || null;
  } catch {
    return null;
  }
}

export function normalizeAllowedDomains(values: string[]) {
  return Array.from(
    new Set(values.map(normalizeDomain).filter((value): value is string => Boolean(value)))
  ).slice(0, 100);
}

export function isDomainAllowed(domain: string, allowedDomains: string[]) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;

  return allowedDomains.some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`)
  );
}

/** Which of a message's domains should be treated as violations under the given Link Protection mode (spec §22). */
export function filterBlockedDomains(input: {
  mode: LinkProtectionMode;
  domains: string[];
  allowedDomains: string[];
  blockedDomains: string[];
}): string[] {
  switch (input.mode) {
    case "ALLOW_ALL":
      return [];
    case "BLOCK_ALL":
      return input.domains;
    case "WHITELIST_ONLY":
      return input.domains.filter((domain) => !isDomainAllowed(domain, input.allowedDomains));
    case "BLACKLIST_ONLY":
      return input.domains.filter((domain) => isDomainAllowed(domain, input.blockedDomains));
  }
}

function entityValue(text: string, entity: TelegramMessageEntity) {
  if (entity.type === "text_link" && entity.url) return entity.url;
  if (entity.type !== "url") return null;
  return text.slice(entity.offset, entity.offset + entity.length);
}

function collectEntityLinks(
  text: string | undefined,
  entities: TelegramMessageEntity[] | undefined
) {
  if (!text || !entities) return [];
  return entities
    .map((entity) => entityValue(text, entity))
    .filter((value): value is string => Boolean(value));
}

export function extractLinkDomains(message: TelegramMessage) {
  const links = [
    ...collectEntityLinks(message.text, message.entities),
    ...collectEntityLinks(message.caption, message.caption_entities)
  ];

  for (const source of [message.text, message.caption]) {
    if (!source) continue;
    for (const match of source.matchAll(URL_FALLBACK_PATTERN)) {
      links.push(match[0]);
    }
  }

  return Array.from(
    new Set(links.map(normalizeDomain).filter((value): value is string => Boolean(value)))
  );
}

export function normalizeModerationText(value: string | null | undefined) {
  return value
    ?.normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/gu, " ")
    .trim() ?? "";
}

export function normalizeBlockedTerms(values: string[]) {
  return Array.from(
    new Set(values.map(normalizeModerationText).filter(Boolean))
  ).slice(0, 200);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsBlockedTerm(content: string, term: string) {
  if (!content || !term) return false;
  const expression = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(term)}(?:$|[^\\p{L}\\p{N}_])`,
    "u"
  );
  return expression.test(content);
}

export function findBlockedTerms(message: TelegramMessage, blockedTerms: string[]) {
  const content = normalizeModerationText(
    [message.text, message.caption].filter(Boolean).join(" ")
  );
  if (!content) return [];

  return normalizeBlockedTerms(blockedTerms).filter((term) =>
    containsBlockedTerm(content, term)
  );
}

function mentionEntities(message: TelegramMessage) {
  return [...(message.entities ?? []), ...(message.caption_entities ?? [])].filter(
    (entity) => entity.type === "mention" || entity.type === "text_mention"
  );
}

export function countMentions(message: TelegramMessage) {
  return mentionEntities(message).length;
}

export function isFloodViolation(messageCount: number, maxMessages: number) {
  return messageCount > maxMessages;
}

export function isDuplicateViolation(duplicateCount: number, maxMessages: number) {
  return duplicateCount > maxMessages;
}

function revisionDate(message: TelegramMessage) {
  return new Date((message.edit_date ?? message.date) * 1000);
}

function telegramErrorMessage(error: unknown) {
  if (error instanceof TelegramApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Telegram не выполнил удаление сообщения.";
}

function isAlreadyDeletedError(error: unknown) {
  return (
    error instanceof TelegramApiError &&
    error.message.toLowerCase().includes("message to delete not found")
  );
}

async function finishWithoutDeletion(messageId: string, result: string) {
  await prisma.message.update({
    where: { id: messageId },
    data: {
      automodResult: result,
      automodClaimedAt: null
    }
  });
}

async function recordDeletion(input: {
  messageId: string;
  chatId: string;
  affectedUserId: string;
  rule: AutomodRule;
  metadata: Prisma.InputJsonValue;
}) {
  const now = new Date();
  await prisma.$transaction([
    prisma.message.update({
      where: { id: input.messageId },
      data: {
        automodResult: RESULT_BY_RULE[input.rule],
        automodClaimedAt: null,
        deletedAt: now
      }
    }),
    prisma.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.affectedUserId,
        source: "SYSTEM",
        action: AUDIT_BY_RULE[input.rule],
        reason: REASON_BY_RULE[input.rule],
        metadata: input.metadata
      }
    })
  ]);
}

async function recordDeleteFailure(input: {
  messageId: string;
  chatId: string;
  affectedUserId: string;
  rule: AutomodRule;
  error: string;
  metadata: Prisma.InputJsonValue;
}) {
  await prisma.$transaction([
    prisma.message.update({
      where: { id: input.messageId },
      data: {
        automodResult: "DELETE_FAILED",
        automodClaimedAt: null
      }
    }),
    prisma.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.affectedUserId,
        source: "SYSTEM",
        action: "AUTOMOD_DELETE_FAILED",
        reason: input.error.slice(0, 500),
        metadata: {
          rule: input.rule,
          details: input.metadata,
          telegramError: input.error.slice(0, 500)
        }
      }
    })
  ]);
}

async function countRecentDuplicates(input: {
  chatId: string;
  senderUserId: string;
  messageId: string;
  telegramDate: Date;
  windowSeconds: number;
  content: string;
}) {
  if (!input.content) return 0;
  const windowStart = new Date(
    input.telegramDate.getTime() - input.windowSeconds * 1000
  );
  const recent = await prisma.message.findMany({
    where: {
      chatId: input.chatId,
      senderUserId: input.senderUserId,
      id: { not: input.messageId },
      telegramDate: {
        gte: windowStart,
        lte: input.telegramDate
      }
    },
    orderBy: { telegramDate: "desc" },
    take: 100,
    select: { text: true, caption: true }
  });

  return recent.filter((message) => {
    const candidate = normalizeModerationText(
      [message.text, message.caption].filter(Boolean).join(" ")
    );
    return candidate === input.content;
  }).length + 1;
}

export async function processAutomodMessage(input: {
  chatId: string;
  message: TelegramMessage;
  isEdited: boolean;
}) {
  if (!input.message.from || input.message.from.is_bot) {
    return { processed: false, result: "IGNORED_SENDER" as const, mediaFilterRule: null };
  }

  const stored = await prisma.message.findUnique({
    where: {
      chatId_telegramMessageId: {
        chatId: input.chatId,
        telegramMessageId: BigInt(input.message.message_id)
      }
    },
    select: {
      id: true,
      senderUserId: true,
      telegramDate: true,
      messageType: true
    }
  });

  if (!stored?.senderUserId) {
    return { processed: false, result: "MESSAGE_NOT_READY" as const, mediaFilterRule: null };
  }

  const revisionAt = revisionDate(input.message);
  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - CLAIM_STALE_MS);
  const claim = await prisma.message.updateMany({
    where: {
      id: stored.id,
      OR: [
        { automodRevisionAt: null },
        { automodRevisionAt: { lt: revisionAt } },
        {
          automodRevisionAt: revisionAt,
          automodResult: "PROCESSING",
          automodClaimedAt: { lt: staleBefore }
        }
      ]
    },
    data: {
      automodRevisionAt: revisionAt,
      automodClaimedAt: claimedAt,
      automodResult: "PROCESSING"
    }
  });

  if (claim.count === 0) {
    return { processed: false, result: "DUPLICATE_REVISION" as const, mediaFilterRule: null };
  }

  const resolvedPolicy = await resolveEffectiveModerationSettings(input.chatId);
  const settings = resolvedPolicy.settings;
  const rulesEnabled = Boolean(
    settings.linkProtectionMode !== "ALLOW_ALL" ||
      settings.spamEnabled ||
      settings.blockedTermsEnabled ||
      settings.massMentionsEnabled ||
      settings.duplicateEnabled ||
      settings.mediaFilters.some((filterRule) => filterRule.enabled)
  );

  if (!rulesEnabled) {
    await finishWithoutDeletion(stored.id, "DISABLED");
    return { processed: true, result: "DISABLED" as const, mediaFilterRule: null };
  }

  if (settings.ignoreAdmins) {
    const membership = await prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: input.chatId,
          userId: stored.senderUserId
        }
      },
      select: { status: true }
    });

    if (membership && PROTECTED_STATUSES.has(membership.status)) {
      await finishWithoutDeletion(stored.id, "EXEMPT_ADMIN");
      return { processed: true, result: "EXEMPT_ADMIN" as const, mediaFilterRule: null };
    }
  }

  const domains = settings.linkProtectionMode !== "ALLOW_ALL" ? extractLinkDomains(input.message) : [];
  const blockedDomains = filterBlockedDomains({
    mode: settings.linkProtectionMode,
    domains,
    allowedDomains: normalizeAllowedDomains(settings.allowedDomains),
    blockedDomains: normalizeAllowedDomains(settings.blockedDomains)
  });
  const blockedTerms = settings.blockedTermsEnabled
    ? findBlockedTerms(input.message, settings.blockedTerms)
    : [];
  const mentionCount = settings.massMentionsEnabled
    ? countMentions(input.message)
    : 0;
  // Every restrictable content type is now Filters-managed (MEDIA_FILTER_TYPES
  // covers all 12), so this is read exclusively from mediaFilters -- the old
  // flat blockedMessageTypes fallback has been removed.
  const mediaFilterRule = findEnabledMediaFilterRule(settings.mediaFilters, stored.messageType);
  const blockedMessageType = mediaFilterRule ? stored.messageType : null;

  let rule: AutomodRule | null = null;
  if (blockedDomains.length > 0) rule = "LINK";
  else if (blockedTerms.length > 0) rule = "TERM";
  else if (blockedMessageType) rule = "MEDIA";
  else if (settings.massMentionsEnabled && mentionCount > settings.maxMentions) {
    rule = "MENTIONS";
  }

  let duplicateCount: number | null = null;
  if (!rule && settings.duplicateEnabled) {
    const content = normalizeModerationText(
      [input.message.text, input.message.caption].filter(Boolean).join(" ")
    );
    duplicateCount = await countRecentDuplicates({
      chatId: input.chatId,
      senderUserId: stored.senderUserId,
      messageId: stored.id,
      telegramDate: stored.telegramDate,
      windowSeconds: settings.duplicateWindowSeconds,
      content
    });
    if (content && isDuplicateViolation(duplicateCount, settings.duplicateMaxMessages)) {
      rule = "DUPLICATE";
    }
  }

  let floodCount: number | null = null;
  if (!rule && settings.spamEnabled && !input.isEdited) {
    const windowStart = new Date(
      stored.telegramDate.getTime() - settings.spamWindowSeconds * 1000
    );
    floodCount = await prisma.message.count({
      where: {
        chatId: input.chatId,
        senderUserId: stored.senderUserId,
        telegramDate: {
          gte: windowStart,
          lte: stored.telegramDate
        }
      }
    });

    if (isFloodViolation(floodCount, settings.spamMaxMessages)) {
      rule = "SPAM";
    }
  }

  if (!rule) {
    await finishWithoutDeletion(stored.id, "CLEAN");
    return { processed: true, result: "CLEAN" as const, mediaFilterRule: null };
  }

  const metadata = {
    telegramMessageId: String(input.message.message_id),
    rule,
    policySource: resolvedPolicy.source,
    blockedDomains,
    blockedTerms,
    blockedMessageType,
    mediaFilterType: mediaFilterRule?.type ?? null,
    mentionCount,
    maxMentions: settings.maxMentions,
    duplicateCount,
    duplicateWindowSeconds: settings.duplicateWindowSeconds,
    duplicateMaxMessages: settings.duplicateMaxMessages,
    floodCount,
    spamWindowSeconds: settings.spamWindowSeconds,
    spamMaxMessages: settings.spamMaxMessages,
    edited: input.isEdited
  } satisfies Prisma.InputJsonValue;

  try {
    await getTelegramClient().deleteMessage(
      input.message.chat.id,
      input.message.message_id
    );
  } catch (error) {
    if (!isAlreadyDeletedError(error)) {
      const message = telegramErrorMessage(error);
      await recordDeleteFailure({
        messageId: stored.id,
        chatId: input.chatId,
        affectedUserId: stored.senderUserId,
        rule,
        error: message,
        metadata
      });
      return { processed: true, result: "DELETE_FAILED" as const, mediaFilterRule: null };
    }
  }

  await recordDeletion({
    messageId: stored.id,
    chatId: input.chatId,
    affectedUserId: stored.senderUserId,
    rule,
    metadata
  });

  return {
    processed: true,
    result: RESULT_BY_RULE[rule],
    // Only meaningful when rule === "MEDIA" -- lets the caller
    // (update-handler.ts) decide whether to escalate/announce per the
    // matched type's own warnOnTrigger/notifyEnabled, instead of the
    // chat-wide default every other rule uses.
    mediaFilterRule
  };
}