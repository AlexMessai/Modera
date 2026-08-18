import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  getTelegramBotProfile,
  getTelegramClient,
  TelegramApiError
} from "@/server/telegram/client";
import { extractBotPermissions } from "@/server/telegram/status";

export const MESSAGE_TYPES = [
  "TEXT",
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
  "CONTACT",
  "SERVICE",
  "OTHER"
] as const;

export const MESSAGE_STATES = [
  "ALL",
  "ACTIVE",
  "DELETED",
  "AUTOMOD_DELETED",
  "DELETE_FAILED",
  "EDITED"
] as const;

export type MessageTypeValue = (typeof MESSAGE_TYPES)[number];
export type MessageStateValue = (typeof MESSAGE_STATES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MessageActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "MessageActionError";
  }
}

export function isMessageType(value: string): value is MessageTypeValue {
  return MESSAGE_TYPES.includes(value as MessageTypeValue);
}

export function isMessageState(value: string): value is MessageStateValue {
  return MESSAGE_STATES.includes(value as MessageStateValue);
}

function stateWhere(state: MessageStateValue): Prisma.MessageWhereInput {
  switch (state) {
    case "ACTIVE":
      return { deletedAt: null };
    case "DELETED":
      return { deletedAt: { not: null } };
    case "AUTOMOD_DELETED":
      return { automodResult: { in: ["DELETED_LINK", "DELETED_SPAM"] } };
    case "DELETE_FAILED":
      return { automodResult: "DELETE_FAILED" };
    case "EDITED":
      return { isEdited: true };
    case "ALL":
      return {};
  }
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function listMessages(input: {
  page: number;
  pageSize: number;
  search?: string;
  sender?: string;
  chatId?: string;
  type?: MessageTypeValue;
  state: MessageStateValue;
  dateFrom?: string;
  dateTo?: string;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const search = input.search?.trim() || undefined;
  const sender = input.sender?.trim() || undefined;
  const dateFrom = parseDate(input.dateFrom);
  const dateTo = parseDate(input.dateTo);

  const where: Prisma.MessageWhereInput = {
    ...(input.chatId && UUID_PATTERN.test(input.chatId) ? { chatId: input.chatId } : {}),
    ...(input.type ? { messageType: input.type } : {}),
    ...stateWhere(input.state),
    ...(dateFrom || dateTo
      ? {
          telegramDate: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {})
          }
        }
      : {}),
    ...(search
      ? {
          OR: [
            { text: { contains: search, mode: "insensitive" } },
            { caption: { contains: search, mode: "insensitive" } },
            { chat: { title: { contains: search, mode: "insensitive" } } },
            { sender: { displayName: { contains: search, mode: "insensitive" } } },
            { sender: { username: { contains: search, mode: "insensitive" } } }
          ]
        }
      : {}),
    ...(sender
      ? {
          sender: {
            OR: [
              { displayName: { contains: sender, mode: "insensitive" } },
              { username: { contains: sender.replace(/^@/, ""), mode: "insensitive" } },
              ...( /^\d+$/.test(sender)
                ? [{ telegramUserId: BigInt(sender) }]
                : [])
            ]
          }
        }
      : {})
  };

  const [total, items, chats] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.findMany({
      where,
      orderBy: [{ telegramDate: "desc" }, { telegramMessageId: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        chat: {
          select: {
            id: true,
            title: true,
            telegramChatId: true
          }
        },
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
            telegramUserId: true,
            isBot: true
          }
        }
      }
    }),
    prisma.chat.findMany({
      orderBy: { title: "asc" },
      take: 200,
      select: {
        id: true,
        title: true,
        telegramChatId: true
      }
    })
  ]);

  return {
    items: items.map((message) => ({
      id: message.id,
      telegramMessageId: message.telegramMessageId.toString(),
      telegramDate: message.telegramDate.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      text: message.text,
      caption: message.caption,
      messageType: message.messageType,
      isEdited: message.isEdited,
      automodResult: message.automodResult,
      deletedAt: message.deletedAt?.toISOString() ?? null,
      chat: {
        id: message.chat.id,
        title: message.chat.title,
        telegramChatId: message.chat.telegramChatId.toString()
      },
      sender: message.sender
        ? {
            id: message.sender.id,
            displayName: message.sender.displayName,
            username: message.sender.username,
            telegramUserId: message.sender.telegramUserId.toString(),
            isBot: message.sender.isBot
          }
        : null
    })),
    chats: chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      telegramChatId: chat.telegramChatId.toString()
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

function isAlreadyGone(error: unknown) {
  return (
    error instanceof TelegramApiError &&
    error.message.toLowerCase().includes("message to delete not found")
  );
}

export async function deleteStoredMessage(input: {
  messageId: string;
  actingAdminId: string;
  reason: string;
}) {
  if (!UUID_PATTERN.test(input.messageId)) {
    throw new MessageActionError("MESSAGE_NOT_FOUND", "Сообщение не найдено.", 404);
  }

  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 2) {
    throw new MessageActionError(
      "REASON_REQUIRED",
      "Укажите причину удаления сообщения.",
      400
    );
  }

  const message = await prisma.message.findUnique({
    where: { id: input.messageId },
    include: {
      chat: true,
      sender: true
    }
  });

  if (!message) {
    throw new MessageActionError("MESSAGE_NOT_FOUND", "Сообщение не найдено.", 404);
  }

  if (message.deletedAt) {
    throw new MessageActionError(
      "MESSAGE_ALREADY_DELETED",
      "Сообщение уже отмечено как удалённое.",
      409
    );
  }

  const client = getTelegramClient();
  const botProfile = await getTelegramBotProfile();
  const botMember = await client.getChatMember(
    Number(message.chat.telegramChatId),
    botProfile.id
  );
  const permissions = extractBotPermissions(botMember);

  if (
    (botMember.status !== "administrator" && botMember.status !== "creator") ||
    !permissions.canDeleteMessages
  ) {
    throw new MessageActionError(
      "BOT_PERMISSION_REQUIRED",
      "У бота нет права удалять сообщения в этом чате.",
      409
    );
  }

  let alreadyGone = false;
  try {
    await client.deleteMessage(
      Number(message.chat.telegramChatId),
      Number(message.telegramMessageId)
    );
  } catch (error) {
    if (isAlreadyGone(error)) {
      alreadyGone = true;
    } else {
      const telegramError =
        error instanceof TelegramApiError
          ? error.message
          : "Telegram не выполнил удаление сообщения.";

      await prisma.auditLog.create({
        data: {
          chatId: message.chatId,
          affectedUserId: message.senderUserId,
          actingAdminId: input.actingAdminId,
          source: "ADMIN",
          action: "MANUAL_MESSAGE_DELETE_FAILED",
          reason,
          metadata: {
            storedMessageId: message.id,
            telegramMessageId: message.telegramMessageId.toString(),
            telegramError: telegramError.slice(0, 500)
          }
        }
      });

      throw new MessageActionError(
        "TELEGRAM_DELETE_FAILED",
        telegramError,
        502
      );
    }
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.message.update({
      where: { id: message.id },
      data: {
        deletedAt: now,
        automodResult: alreadyGone ? "ALREADY_GONE" : "MANUAL_DELETED"
      }
    }),
    prisma.auditLog.create({
      data: {
        chatId: message.chatId,
        affectedUserId: message.senderUserId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: alreadyGone ? "MANUAL_MESSAGE_ALREADY_GONE" : "MANUAL_MESSAGE_DELETED",
        reason,
        metadata: {
          storedMessageId: message.id,
          telegramMessageId: message.telegramMessageId.toString(),
          telegramChatId: message.chat.telegramChatId.toString()
        }
      }
    })
  ]);

  return {
    id: message.id,
    deletedAt: now.toISOString(),
    result: alreadyGone ? "ALREADY_GONE" : "MANUAL_DELETED"
  };
}
