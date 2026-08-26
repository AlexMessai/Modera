import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

export const JOURNAL_CATEGORIES = ["ALL", "MANUAL", "AUTOMOD", "ERRORS", "SETTINGS", "PENDING"] as const;
export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];

const MANUAL_ACTIONS = [
  "MODERATION_WARNING", "MODERATION_UNWARN", "MODERATION_MUTE", "MODERATION_UNMUTE", "MODERATION_BAN", "MODERATION_UNBAN", "MODERATION_KICK", "MODERATION_ACTION_FAILED",
  "MODERATION_RECONCILIATION_CHECKED", "MODERATION_RECONCILIATION_CHECK_FAILED",
  "MANUAL_MESSAGE_DELETED", "MANUAL_MESSAGE_ALREADY_GONE", "MANUAL_MESSAGE_DELETE_FAILED",
  "MEMBER_TAG_UPDATED", "MEMBER_TAG_REMOVED", "MEMBER_TAG_UPDATE_FAILED",
  "TELEGRAM_MEMBER_TAG_CHANGED", "TELEGRAM_MEMBER_TAG_REMOVED",
  "MEMBER_STATUS_CHANGED", "MEMBER_JOIN_REQUESTED",
  "REPORT_SUBMITTED", "REPORT_RESOLVED", "REPORT_DISMISSED",
  "SILENCE_STARTED", "SILENCE_STOPPED",
  "JOIN_REQUEST_APPROVED", "JOIN_REQUEST_DECLINED", "JOIN_REQUEST_EXPIRED"
];

const AUTOMOD_ACTIONS = [
  "AUTOMOD_LINK_DELETED", "AUTOMOD_TERM_DELETED", "AUTOMOD_MEDIA_DELETED", "AUTOMOD_MENTIONS_DELETED", "AUTOMOD_DUPLICATE_DELETED", "AUTOMOD_SPAM_DELETED",
  "AUTOMOD_LINK_TRIGGERED", "AUTOMOD_TERM_TRIGGERED", "AUTOMOD_MEDIA_TRIGGERED", "AUTOMOD_MENTIONS_TRIGGERED", "AUTOMOD_DUPLICATE_TRIGGERED", "AUTOMOD_SPAM_TRIGGERED",
  "AUTOMOD_WARNING", "AUTOMOD_AUTO_MUTE", "AUTOMOD_AUTO_BAN", "AUTOMOD_ESCALATION_FAILED", "AUTOMOD_ESCALATION_SKIPPED_PROTECTED", "AUTOMOD_ESCALATION_NOT_TRIGGERED",
  "AUTOMOD_DELETE_FAILED", "AUTOMOD_SETTINGS_UPDATED", "GLOBAL_AUTOMOD_SETTINGS_UPDATED", "MODERATION_EXPIRED_UNMUTE", "MODERATION_EXPIRED_UNBAN",
  "ANTI_RAID_STARTED", "ANTI_RAID_RESOLVED", "SILENCE_EXPIRED",
  "NEW_MEMBER_BLOCKED", "NEW_MEMBER_MUTED", "EXISTING_MEMBER_BLOCKED"
];

const TRUSTED_ACTIONS = ["TRUSTED_MEMBER_ADDED", "TRUSTED_MEMBER_REMOVED"];

// CAPTCHA_TIMEOUT_BAN removed: the ban-on-timeout option was dropped in favor
// of always-kick (docs/STAGE_2.md) -- nothing writes this action anymore, it
// was dead whitelist/label cruft left over from that removal.
const CAPTCHA_ACTIONS = [
  "CAPTCHA_CHALLENGE_SENT", "CAPTCHA_PASSED", "CAPTCHA_TIMEOUT_KICK"
];

const APPEAL_ACTIONS = [
  "APPEAL_SUBMITTED", "APPEAL_APPROVED", "APPEAL_REJECTED", "SELF_UNMUTE"
];

const SETTINGS_ACTIONS = [
  "AUTOMOD_SETTINGS_UPDATED",
  "GLOBAL_AUTOMOD_SETTINGS_UPDATED",
  "CAPTCHA_SETTINGS_UPDATED",
  "MANUAL_MODERATION_SETTINGS_UPDATED",
  "GLOBAL_MANUAL_MODERATION_SETTINGS_UPDATED",
  "ANTI_RAID_SETTINGS_UPDATED",
  "REPORT_SETTINGS_UPDATED",
  "LOG_CHANNEL_LINKED",
  "LOG_CHANNEL_UNLINKED",
  "LOG_CHANNEL_SETTINGS_UPDATED",
  "CHAT_ROLE_UPDATED",
  "CONTENT_SETTINGS_UPDATED",
  "GLOBAL_APPEAL_SETTINGS_UPDATED",
  "AUTO_RESPONSE_CREATED",
  "AUTO_RESPONSE_UPDATED",
  "AUTO_RESPONSE_DELETED",
  "CUSTOM_COMMAND_CREATED",
  "CUSTOM_COMMAND_UPDATED",
  "CUSTOM_COMMAND_DELETED",
  "ADMIN_ACCOUNT_CREATED",
  "ADMIN_ACCOUNT_UPDATED",
  "ADMIN_SESSIONS_REVOKED",
  "ADMIN_ACCOUNT_SELF_REGISTERED",
  "CHAT_ADMIN_ACCESS_GRANTED",
  "CHAT_ADMIN_ACCESS_UPDATED",
  "CHAT_ADMIN_ACCESS_REVOKED",
  "CHAT_ADMIN_ACCESS_AUTO_SYNCED",
  "APPEAL_SETTINGS_UPDATED",
  "ADMIN_TELEGRAM_LINKED",
  "ADMIN_TELEGRAM_UNLINKED",
  "MODERATION_NOTIFICATION_PROFILES_UPDATED",
  ...TRUSTED_ACTIONS
];
// Spread SETTINGS_ACTIONS here instead of re-listing its members: this array
// used to keep its own hand-typed copy of every settings action, so a new
// entry added only to SETTINGS_ACTIONS (the list actually used to gate the
// "Settings" journal-category filter) would silently never show up under
// "All" -- exactly the whitelist-drift bug this file has hit before.
const JOURNAL_ACTIONS = [
  ...MANUAL_ACTIONS, ...AUTOMOD_ACTIONS,
  ...CAPTCHA_ACTIONS, ...APPEAL_ACTIONS, ...SETTINGS_ACTIONS,
  "PUNISHMENT_STATE_CONFIRMED", "PUNISHMENT_STATE_CLEARED",
  "CHAT_DISCOVERED", "JOIN_REQUEST_ACTION_FAILED"
];
const ERROR_ACTIONS = [
  "MODERATION_ACTION_FAILED",
  "MODERATION_RECONCILIATION_CHECK_FAILED",
  "AUTOMOD_DELETE_FAILED",
  "AUTOMOD_ESCALATION_FAILED",
  "MANUAL_MESSAGE_DELETE_FAILED",
  "MEMBER_TAG_UPDATE_FAILED",
  "JOIN_REQUEST_ACTION_FAILED"
];

function auditActionFilter(category: JournalCategory): Prisma.StringFilter {
  switch (category) {
    case "MANUAL": return { in: MANUAL_ACTIONS };
    case "AUTOMOD": return { in: AUTOMOD_ACTIONS };
    case "ERRORS": return { in: ERROR_ACTIONS };
    case "SETTINGS": return { in: SETTINGS_ACTIONS };
    case "PENDING": return { equals: "__PENDING_ONLY__" };
    case "ALL": return { in: JOURNAL_ACTIONS };
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
  // Additive scoping for the top-level /incidents page: null/undefined = no
  // filter (unchanged behavior, matches the listChats/listChatsForAdmin
  // sentinel convention); an array restricts to those chats. When an
  // explicit single `chatId` was also requested (the per-chat journal tab),
  // that takes precedence and this is ignored -- a chat already passed
  // requireChatAccess by the time it reaches here.
  visibleChatIds?: string[] | null;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const search = input.search?.trim() || undefined;
  const chatScope = input.chatId
    ? { chatId: input.chatId }
    : input.visibleChatIds
      ? { chatId: { in: input.visibleChatIds } }
      : {};
  const auditWhere: Prisma.AuditLogWhereInput = { action: auditActionFilter(input.category), ...chatScope, ...(search ? { OR: searchFilter(search) } : {}) };
  const includePending = ["ALL", "MANUAL", "AUTOMOD", "PENDING"].includes(input.category);
  const pendingWhere: Prisma.ModerationActionWhereInput = { status: "PENDING", ...(input.category === "AUTOMOD" ? { source: "SYSTEM" } : {}), ...(input.category === "MANUAL" ? { source: "ADMIN" } : {}), ...chatScope, ...(search ? { OR: pendingSearchFilter(search) } : {}) };

  const [total, events, pendingRows, chats] = await Promise.all([
    prisma.auditLog.count({ where: auditWhere }),
    prisma.auditLog.findMany({
      where: auditWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
      include: { chat: { select: { id: true, title: true, telegramChatId: true } }, affectedUser: { select: { id: true, displayName: true, username: true, telegramUserId: true } }, actingAdmin: { select: { id: true, displayName: true, email: true } } }
    }),
    prisma.moderationAction.findMany({
      where: pendingWhere, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20,
      include: { chat: { select: { id: true, title: true, telegramChatId: true } }, affectedUser: { select: { id: true, displayName: true, username: true, telegramUserId: true } }, actingAdmin: { select: { id: true, displayName: true, email: true } } }
    }),
    prisma.chat.findMany({
      where: input.visibleChatIds ? { id: { in: input.visibleChatIds } } : undefined,
      orderBy: { title: "asc" }, take: 200, select: { id: true, title: true, telegramChatId: true }
    })
  ]);

  const pending = includePending ? pendingRows : [];
  return {
    pending: pending.map((item) => ({
      id: item.id, source: item.source, type: item.type, reason: item.reason, expiresAt: item.expiresAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(),
      chat: { id: item.chat.id, title: item.chat.title, telegramChatId: item.chat.telegramChatId.toString() },
      affectedUser: { id: item.affectedUser.id, displayName: item.affectedUser.displayName, username: item.affectedUser.username, telegramUserId: item.affectedUser.telegramUserId.toString() },
      actingAdmin: item.actingAdmin
    })),
    items: events.map((event) => ({
      id: event.id, source: event.source, action: event.action, reason: event.reason, metadata: event.metadata, createdAt: event.createdAt.toISOString(),
      status: ERROR_ACTIONS.includes(event.action) ? "FAILED" : "SUCCEEDED",
      chat: event.chat ? { id: event.chat.id, title: event.chat.title, telegramChatId: event.chat.telegramChatId.toString() } : null,
      affectedUser: event.affectedUser ? { id: event.affectedUser.id, displayName: event.affectedUser.displayName, username: event.affectedUser.username, telegramUserId: event.affectedUser.telegramUserId.toString() } : null,
      actingAdmin: event.actingAdmin
    })),
    chats: chats.map((chat) => ({ id: chat.id, title: chat.title, telegramChatId: chat.telegramChatId.toString() })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  };
}
