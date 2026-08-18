import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
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

export type AutomodRule = "LINK" | "SPAM";

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

function entityValue(
  text: string,
  entity: TelegramMessageEntity
) {
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

export function isFloodViolation(messageCount: number, maxMessages: number) {
  return messageCount > maxMessages;
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
        automodResult: input.rule === "LINK" ? "DELETED_LINK" : "DELETED_SPAM",
        automodClaimedAt: null,
        deletedAt: now
      }
    }),
    prisma.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.affectedUserId,
        source: "SYSTEM",
        action: input.rule === "LINK" ? "AUTOMOD_LINK_DELETED" : "AUTOMOD_SPAM_DELETED",
        reason:
          input.rule === "LINK"
            ? "Автомодерация: запрещённая ссылка"
            : "Автомодерация: превышен лимит сообщений",
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

export async function processAutomodMessage(input: {
  chatId: string;
  message: TelegramMessage;
  isEdited: boolean;
}) {
  if (!input.message.from || input.message.from.is_bot) {
    return { processed: false, result: "IGNORED_SENDER" as const };
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
      telegramDate: true
    }
  });

  if (!stored?.senderUserId) {
    return { processed: false, result: "MESSAGE_NOT_READY" as const };
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
    return { processed: false, result: "DUPLICATE_REVISION" as const };
  }

  const settings = await prisma.chatModerationSettings.findUnique({
    where: { chatId: input.chatId }
  });

  if (!settings || (!settings.blockLinks && !settings.spamEnabled)) {
    await finishWithoutDeletion(stored.id, "DISABLED");
    return { processed: true, result: "DISABLED" as const };
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
      return { processed: true, result: "EXEMPT_ADMIN" as const };
    }
  }

  const allowedDomains = normalizeAllowedDomains(settings.allowedDomains);
  const domains = settings.blockLinks ? extractLinkDomains(input.message) : [];
  const blockedDomains = domains.filter(
    (domain) => !isDomainAllowed(domain, allowedDomains)
  );

  let rule: AutomodRule | null = blockedDomains.length > 0 ? "LINK" : null;
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
    return { processed: true, result: "CLEAN" as const };
  }

  const metadata = {
    telegramMessageId: String(input.message.message_id),
    rule,
    blockedDomains,
    allowedDomains,
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
      return { processed: true, result: "DELETE_FAILED" as const };
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
    result: rule === "LINK" ? ("DELETED_LINK" as const) : ("DELETED_SPAM" as const)
  };
}
