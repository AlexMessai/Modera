import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  getTelegramBotProfile,
  getTelegramClient,
  TelegramApiError
} from "@/server/telegram/client";
import type { TelegramChatJoinRequest, TelegramChatMember } from "@/server/telegram/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROCESSING_STALE_MS = 2 * 60 * 1000;

type JoinAction = "APPROVE" | "DECLINE";
type JoinStatus = "PENDING" | "APPROVED" | "DECLINED";

export class JoinRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "JoinRequestError";
  }
}

function displayName(request: TelegramChatJoinRequest) {
  const user = request.from;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return `Telegram ${user.id}`;
}

function isActiveTelegramMember(member: TelegramChatMember) {
  return ["creator", "administrator", "member", "restricted"].includes(member.status);
}

async function finalizeAction(input: {
  requestId: string;
  actingAdminId: string;
  action: JoinAction;
  reconciledAfterError?: boolean;
}) {
  const request = await prisma.joinRequest.findUnique({
    where: { id: input.requestId },
    include: { chat: true, user: true }
  });
  if (!request) {
    throw new JoinRequestError("JOIN_REQUEST_NOT_FOUND", "Заявка не найдена.", 404);
  }

  const status: JoinStatus = input.action === "APPROVE" ? "APPROVED" : "DECLINED";
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const resolved = await tx.joinRequest.update({
      where: { id: request.id },
      data: {
        status,
        resolvedAt: now,
        resolvedByAdminId: input.actingAdminId,
        processingAt: null,
        telegramError: null
      },
      include: {
        chat: { select: { id: true, title: true, telegramChatId: true } },
        user: { select: { id: true, displayName: true, username: true, telegramUserId: true } },
        resolvedByAdmin: { select: { displayName: true } }
      }
    });

    await tx.chatMember.updateMany({
      where: {
        chatId: request.chatId,
        userId: request.userId,
        status: "PENDING"
      },
      data:
        status === "APPROVED"
          ? { status: "MEMBER", joinedAt: now, leftAt: null, lastSeenAt: now }
          : { status: "LEFT", leftAt: now, lastSeenAt: now }
    });

    await tx.auditLog.create({
      data: {
        chatId: request.chatId,
        affectedUserId: request.userId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: status === "APPROVED" ? "JOIN_REQUEST_APPROVED" : "JOIN_REQUEST_DECLINED",
        metadata: {
          joinRequestId: request.id,
          telegramUpdateId: request.telegramUpdateId.toString(),
          ...(input.reconciledAfterError ? { reconciledAfterTelegramError: true } : {})
        }
      }
    });

    return {
      id: resolved.id,
      status: resolved.status,
      resolvedAt: resolved.resolvedAt?.toISOString() ?? null,
      resolvedBy: resolved.resolvedByAdmin?.displayName ?? null
    };
  });
}

export async function recordTelegramJoinRequest(input: {
  chatId: string;
  request: TelegramChatJoinRequest;
  updateId: number;
}) {
  const requestedAt = new Date(input.request.date * 1000);
  const bio = input.request.bio?.trim().slice(0, 500) || null;
  const inviteLink = input.request.invite_link?.invite_link ?? null;

  return prisma.$transaction(async (tx) => {
    const user = await tx.telegramUser.upsert({
      where: { telegramUserId: BigInt(input.request.from.id) },
      create: {
        telegramUserId: BigInt(input.request.from.id),
        username: input.request.from.username,
        firstName: input.request.from.first_name,
        lastName: input.request.from.last_name,
        displayName: displayName(input.request),
        isBot: input.request.from.is_bot,
        languageCode: input.request.from.language_code,
        firstSeenAt: requestedAt,
        lastSeenAt: requestedAt
      },
      update: {
        username: input.request.from.username,
        firstName: input.request.from.first_name,
        lastName: input.request.from.last_name,
        displayName: displayName(input.request),
        isBot: input.request.from.is_bot,
        languageCode: input.request.from.language_code,
        lastSeenAt: requestedAt
      }
    });

    await tx.chatMember.upsert({
      where: { chatId_userId: { chatId: input.chatId, userId: user.id } },
      create: {
        chatId: input.chatId,
        userId: user.id,
        status: "PENDING",
        firstSeenAt: requestedAt,
        lastSeenAt: requestedAt,
        lastTelegramUpdateId: BigInt(input.updateId)
      },
      update: {
        status: "PENDING",
        leftAt: null,
        lastSeenAt: requestedAt,
        lastTelegramUpdateId: BigInt(input.updateId)
      }
    });

    return tx.joinRequest.upsert({
      where: { telegramUpdateId: BigInt(input.updateId) },
      create: {
        chatId: input.chatId,
        userId: user.id,
        telegramUpdateId: BigInt(input.updateId),
        userChatId: BigInt(input.request.user_chat_id),
        bio,
        inviteLink,
        requestedAt
      },
      update: {}
    });
  });
}

export async function listJoinRequests(input: {
  page: number;
  pageSize: number;
  status: JoinStatus;
  chatId?: string;
  search?: string;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const search = input.search?.trim() || undefined;

  const where: Prisma.JoinRequestWhereInput = {
    status: input.status,
    ...(input.chatId ? { chatId: input.chatId } : {}),
    ...(search
      ? {
          OR: [
            { bio: { contains: search, mode: "insensitive" } },
            { chat: { title: { contains: search, mode: "insensitive" } } },
            { user: { displayName: { contains: search, mode: "insensitive" } } },
            { user: { username: { contains: search, mode: "insensitive" } } }
          ]
        }
      : {})
  };

  const [total, pendingCount, items, chats] = await Promise.all([
    prisma.joinRequest.count({ where }),
    prisma.joinRequest.count({ where: { status: "PENDING" } }),
    prisma.joinRequest.findMany({
      where,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        chat: { select: { id: true, title: true, telegramChatId: true } },
        user: { select: { id: true, displayName: true, username: true, telegramUserId: true } },
        resolvedByAdmin: { select: { displayName: true } }
      }
    }),
    prisma.chat.findMany({
      where: { joinRequests: { some: {} } },
      orderBy: { title: "asc" },
      take: 200,
      select: { id: true, title: true }
    })
  ]);

  const activeProcessingAfter = Date.now() - PROCESSING_STALE_MS;
  return {
    pendingCount,
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      bio: item.bio,
      hasInviteLink: Boolean(item.inviteLink),
      requestedAt: item.requestedAt.toISOString(),
      processing: Boolean(item.processingAt && item.processingAt.getTime() > activeProcessingAfter),
      telegramError: item.telegramError,
      resolvedAt: item.resolvedAt?.toISOString() ?? null,
      resolvedBy: item.resolvedByAdmin?.displayName ?? null,
      chat: {
        id: item.chat.id,
        title: item.chat.title,
        telegramChatId: item.chat.telegramChatId.toString()
      },
      user: {
        id: item.user.id,
        displayName: item.user.displayName,
        username: item.user.username,
        telegramUserId: item.user.telegramUserId.toString()
      }
    })),
    chats,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

export async function executeJoinRequestAction(input: {
  requestId: string;
  actingAdminId: string;
  action: JoinAction;
}) {
  if (!UUID_PATTERN.test(input.requestId)) {
    throw new JoinRequestError("JOIN_REQUEST_NOT_FOUND", "Заявка не найдена.", 404);
  }

  const existing = await prisma.joinRequest.findUnique({
    where: { id: input.requestId },
    include: { chat: true, user: true }
  });
  if (!existing) {
    throw new JoinRequestError("JOIN_REQUEST_NOT_FOUND", "Заявка не найдена.", 404);
  }
  if (existing.status !== "PENDING") {
    return {
      id: existing.id,
      status: existing.status,
      resolvedAt: existing.resolvedAt?.toISOString() ?? null,
      resolvedBy: null
    };
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_STALE_MS);
  const claimed = await prisma.joinRequest.updateMany({
    where: {
      id: existing.id,
      status: "PENDING",
      OR: [{ processingAt: null }, { processingAt: { lt: staleBefore } }]
    },
    data: { processingAt: now, telegramError: null }
  });
  if (claimed.count !== 1) {
    const current = await prisma.joinRequest.findUnique({ where: { id: existing.id } });
    if (current && current.status !== "PENDING") {
      return {
        id: current.id,
        status: current.status,
        resolvedAt: current.resolvedAt?.toISOString() ?? null,
        resolvedBy: null
      };
    }
    throw new JoinRequestError(
      "JOIN_REQUEST_PROCESSING",
      "Заявка уже обрабатывается. Обновите список через несколько секунд.",
      409
    );
  }

  const client = getTelegramClient();
  try {
    const bot = await getTelegramBotProfile();
    const botMember = await client.getChatMember(Number(existing.chat.telegramChatId), bot.id);
    const canManageJoinRequests =
      botMember.status === "creator" ||
      (botMember.status === "administrator" && Boolean(botMember.can_invite_users));
    if (!canManageJoinRequests) {
      throw new JoinRequestError(
        "BOT_PERMISSION_REQUIRED",
        "У бота нет права приглашать пользователей и обрабатывать заявки в этом чате.",
        409
      );
    }

    if (input.action === "APPROVE") {
      await client.approveChatJoinRequest(
        Number(existing.chat.telegramChatId),
        Number(existing.user.telegramUserId)
      );
    } else {
      await client.declineChatJoinRequest(
        Number(existing.chat.telegramChatId),
        Number(existing.user.telegramUserId)
      );
    }

    return await finalizeAction(input);
  } catch (error) {
    if (input.action === "APPROVE") {
      try {
        const state = await client.getChatMember(
          Number(existing.chat.telegramChatId),
          Number(existing.user.telegramUserId)
        );
        if (isActiveTelegramMember(state)) {
          return await finalizeAction({ ...input, reconciledAfterError: true });
        }
      } catch {
        // Keep the request pending when Telegram state cannot be confirmed.
      }
    }

    const message =
      error instanceof JoinRequestError || error instanceof TelegramApiError
        ? error.message
        : "Telegram не обработал заявку.";

    await prisma.$transaction([
      prisma.joinRequest.update({
        where: { id: existing.id },
        data: { processingAt: null, telegramError: message.slice(0, 500) }
      }),
      prisma.auditLog.create({
        data: {
          chatId: existing.chatId,
          affectedUserId: existing.userId,
          actingAdminId: input.actingAdminId,
          source: "ADMIN",
          action: "JOIN_REQUEST_ACTION_FAILED",
          metadata: {
            joinRequestId: existing.id,
            attemptedAction: input.action,
            error: message.slice(0, 500)
          }
        }
      })
    ]);

    if (error instanceof JoinRequestError) throw error;
    throw new JoinRequestError("TELEGRAM_JOIN_REQUEST_FAILED", message, 502);
  }
}
