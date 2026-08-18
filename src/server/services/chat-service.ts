import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import type {
  TelegramChat,
  TelegramChatMember,
  TelegramUser
} from "@/server/telegram/types";
import {
  deriveBotStatus,
  extractBotPermissions
} from "@/server/telegram/status";

function chatTitle(chat: TelegramChat) {
  if (chat.title?.trim()) return chat.title.trim();
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
  return name || `Telegram chat ${chat.id}`;
}

export async function upsertTelegramBot(bot: TelegramUser) {
  return prisma.telegramBot.upsert({
    where: { telegramBotId: BigInt(bot.id) },
    create: {
      telegramBotId: BigInt(bot.id),
      username: bot.username,
      firstName: bot.first_name,
      isActive: true,
      lastCheckedAt: new Date()
    },
    update: {
      username: bot.username,
      firstName: bot.first_name,
      isActive: true,
      lastCheckedAt: new Date()
    }
  });
}

export async function syncTelegramChat(input: {
  chat: TelegramChat;
  botDbId: string;
  member?: TelegramChatMember | null;
  memberCount?: number | null;
  activityAt?: Date;
}) {
  const now = new Date();
  const activityAt = input.activityAt ?? now;
  const existing = await prisma.chat.findUnique({
    where: { telegramChatId: BigInt(input.chat.id) },
    select: { id: true }
  });

  return prisma.$transaction(async (tx) => {
    const chat = await tx.chat.upsert({
      where: { telegramChatId: BigInt(input.chat.id) },
      create: {
        telegramChatId: BigInt(input.chat.id),
        title: chatTitle(input.chat),
        username: input.chat.username,
        type: input.chat.type,
        knownMemberCount: input.memberCount ?? null,
        lastActivityAt: activityAt
      },
      update: {
        title: chatTitle(input.chat),
        username: input.chat.username,
        type: input.chat.type,
        knownMemberCount: input.memberCount ?? undefined,
        lastActivityAt: activityAt
      }
    });

    let botStatus: ReturnType<typeof deriveBotStatus> | null = null;

    if (input.member) {
      const permissions = extractBotPermissions(input.member);
      botStatus = deriveBotStatus(input.member);

      await tx.botChat.upsert({
        where: {
          botId_chatId: {
            botId: input.botDbId,
            chatId: chat.id
          }
        },
        create: {
          botId: input.botDbId,
          chatId: chat.id,
          telegramStatus: input.member.status,
          status: botStatus,
          permissions: permissions as Prisma.InputJsonValue,
          lastSeenAt: now
        },
        update: {
          telegramStatus: input.member.status,
          status: botStatus,
          permissions: permissions as Prisma.InputJsonValue,
          lastError: null,
          lastSeenAt: now
        }
      });
    }

    if (!existing) {
      await tx.auditLog.create({
        data: {
          chatId: chat.id,
          source: "TELEGRAM",
          action: "CHAT_DISCOVERED",
          metadata: {
            telegramChatId: String(input.chat.id),
            botStatus: botStatus ?? "CONNECTED"
          }
        }
      });
    }

    return chat;
  });
}

export async function markBotChatTelegramError(input: {
  botDbId: string;
  chatId: string;
  message: string;
}) {
  await prisma.botChat.updateMany({
    where: {
      botId: input.botDbId,
      chatId: input.chatId
    },
    data: {
      status: "TELEGRAM_ERROR",
      lastError: input.message.slice(0, 500),
      lastSeenAt: new Date()
    }
  });
}

export async function listChats(input: {
  page: number;
  pageSize: number;
  search?: string;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const search = input.search?.trim();

  const where: Prisma.ChatWhereInput = search
    ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { username: { contains: search, mode: "insensitive" } },
          ...(BigIntSafe(search)
            ? [{ telegramChatId: BigInt(search) }]
            : [])
        ]
      }
    : {};

  const [total, chats] = await prisma.$transaction([
    prisma.chat.count({ where }),
    prisma.chat.findMany({
      where,
      orderBy: { lastActivityAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        botLinks: {
          orderBy: { lastSeenAt: "desc" },
          take: 1,
          include: {
            bot: {
              select: {
                username: true,
                firstName: true
              }
            }
          }
        }
      }
    })
  ]);

  return {
    items: chats.map((chat) => {
      const link = chat.botLinks[0];
      return {
        id: chat.id,
        telegramChatId: chat.telegramChatId.toString(),
        title: chat.title,
        username: chat.username,
        type: chat.type,
        knownMemberCount: chat.knownMemberCount,
        lastActivityAt: chat.lastActivityAt.toISOString(),
        status: link?.status ?? "DISABLED",
        telegramStatus: link?.telegramStatus ?? null,
        permissions: link?.permissions ?? null,
        botUsername: link?.bot.username ?? null,
        botFirstName: link?.bot.firstName ?? null,
        lastError: link?.lastError ?? null
      };
    }),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

function BigIntSafe(value: string) {
  return /^-?\d{1,20}$/.test(value);
}
