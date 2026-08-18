import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

export const JOURNAL_CATEGORIES = [
  "ALL",
  "MANUAL",
  "AUTOMOD",
  "ERRORS",
  "SETTINGS",
  "PENDING"
] as const;

export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];

const JOURNAL_ACTIONS = [
  "MODERATION_WARNING",
  "MODERATION_MUTE",
  "MODERATION_UNMUTE",
  "MODERATION_BAN",
  "MODERATION_UNBAN",
  "MODERATION_ACTION_FAILED",
  "AUTOMOD_LINK_DELETED",
  "AUTOMOD_SPAM_DELETED",
  "AUTOMOD_DELETE_FAILED",
  "AUTOMOD_SETTINGS_UPDATED"
];

function auditActionFilter(category: JournalCategory): Prisma.StringFilter | undefined {
  switch (category) {
    case "MANUAL":
      return { startsWith: "MODERATION_" };
    case "AUTOMOD":
      return { startsWith: "AUTOMOD_" };
    case "ERRORS":
      return { in: ["MODERATION_ACTION_FAILED", "AUTOMOD_DELETE_FAILED"] };
    case "SETTINGS":
      return { equals: "AUTOMOD_SETTINGS_UPDATED" };
    case "PENDING":
      return { in: [] };
    case "ALL":
      return { in: JOURNAL_ACTIONS };
  }
}

function searchFilter(search: string | undefined): Prisma.AuditLogWhereInput[] {
  if (!search) return [];
  return [
    { reason: { contains: search, mode: "insensitive" } },
    { chat: { title: { contains: search, mode: "insensitive" } } },
    { affectedUser: { displayName: { contains: search, mode: "insensitive" } } },
    { affectedUser: { username: { contains: search, mode: "insensitive" } } },
    { actingAdmin: { displayName: { contains: search, mode: "insensitive" } } },
    { actingAdmin: { email: { contains: search, mode: "insensitive" } } }
  ];
}

function pendingSearchFilter(search: string | undefined): Prisma.ModerationActionWhereInput[] {
  if (!search) return [];
  return [
    { reason: { contains: search, mode: "insensitive" } },
    { chat: { title: { contains: search, mode: "insensitive" } } },
    { affectedUser: { displayName: { contains: search, mode: "insensitive" } } },
    { affectedUser: { username: { contains: search, mode: "insensitive" } } },
    { actingAdmin: { displayName: { contains: search, mode: "insensitive" } } },
    { actingAdmin: { email: { contains: search, mode: "insensitive" } } }
  ];
}

export function isJournalCategory(value: string): value is JournalCategory {
  return JOURNAL_CATEGORIES.includes(value as JournalCategory);
}

export async function listModerationJournal(input: {
  page: number;
  pageSize: number;
  category: JournalCategory;
  chatId?: string;
  search?: string;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const search = input.search?.trim() || undefined;
  const auditWhere: Prisma.AuditLogWhereInput = {
    action: auditActionFilter(input.category),
    ...(input.chatId ? { chatId: input.chatId } : {}),
    ...(search ? { OR: searchFilter(search) } : {})
  };

  const includePending =
    input.category === "ALL" ||
    input.category === "MANUAL" ||
    input.category === "PENDING";

  const pendingWhere: Prisma.ModerationActionWhereInput = {
    status: "PENDING",
    ...(input.chatId ? { chatId: input.chatId } : {}),
    ...(search ? { OR: pendingSearchFilter(search) } : {})
  };

  const [total, events, pending, chats] = await prisma.$transaction([
    prisma.auditLog.count({ where: auditWhere }),
    prisma.auditLog.findMany({
      where: auditWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        chat: { select: { id: true, title: true, telegramChatId: true } },
        affectedUser: {
          select: {
            id: true,
            displayName: true,
            username: true,
            telegramUserId: true
          }
        },
        actingAdmin: { select: { id: true, displayName: true, email: true } }
      }
    }),
    includePending
      ? prisma.moderationAction.findMany({
          where: pendingWhere,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 20,
          include: {
            chat: { select: { id: true, title: true, telegramChatId: true } },
            affectedUser: {
              select: {
                id: true,
                displayName: true,
                username: true,
                telegramUserId: true
              }
            },
            actingAdmin: { select: { id: true, displayName: true, email: true } }
          }
        })
      : prisma.moderationAction.findMany({ where: { id: "__never__" }, take: 0 }),
    prisma.chat.findMany({
      orderBy: { title: "asc" },
      take: 200,
      select: { id: true, title: true, telegramChatId: true }
    })
  ]);

  return {
    pending: pending.map((item) => ({
      id: item.id,
      type: item.type,
      reason: item.reason,
      createdAt: item.createdAt.toISOString(),
      chat: {
        id: item.chat.id,
        title: item.chat.title,
        telegramChatId: item.chat.telegramChatId.toString()
      },
      affectedUser: {
        id: item.affectedUser.id,
        displayName: item.affectedUser.displayName,
        username: item.affectedUser.username,
        telegramUserId: item.affectedUser.telegramUserId.toString()
      },
      actingAdmin: item.actingAdmin
    })),
    items: events.map((event) => ({
      id: event.id,
      source: event.source,
      action: event.action,
      reason: event.reason,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
      status:
        event.action === "MODERATION_ACTION_FAILED" ||
        event.action === "AUTOMOD_DELETE_FAILED"
          ? "FAILED"
          : "SUCCEEDED",
      chat: event.chat
        ? {
            id: event.chat.id,
            title: event.chat.title,
            telegramChatId: event.chat.telegramChatId.toString()
          }
        : null,
      affectedUser: event.affectedUser
        ? {
            id: event.affectedUser.id,
            displayName: event.affectedUser.displayName,
            username: event.affectedUser.username,
            telegramUserId: event.affectedUser.telegramUserId.toString()
          }
        : null,
      actingAdmin: event.actingAdmin
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
