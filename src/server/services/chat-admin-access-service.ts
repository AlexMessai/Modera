import { prisma } from "@/server/db/prisma";
import type { ChatAdminAccessRole } from "@/generated/prisma/client";

export const CHAT_ADMIN_ACCESS_ROLES = ["OWNER", "ADMIN", "MODERATOR"] as const;

export function isChatAdminAccessRole(value: string): value is ChatAdminAccessRole {
  return (CHAT_ADMIN_ACCESS_ROLES as readonly string[]).includes(value);
}

export class ChatAdminAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "ChatAdminAccessError";
  }
}

export type ChatTeamNativeAdmin = {
  membershipId: string;
  telegramUserId: string;
  telegramUserDbId: string;
  displayName: string;
  username: string | null;
  status: "CREATOR" | "ADMINISTRATOR";
};

export type ChatTeamCustomAdmin = {
  accessId: string;
  adminId: string;
  displayName: string;
  telegramUsername: string | null;
  role: ChatAdminAccessRole;
  grantedVia: string;
  createdAt: string;
};

/**
 * Read-only live-Telegram-admin list (from cached ChatMember.status, no live
 * Bot API call — already kept fresh by the member-sync webhook path) plus the
 * chat's custom (manually-added) web-panel admins.
 */
export async function listChatTeam(chatId: string): Promise<{ native: ChatTeamNativeAdmin[]; custom: ChatTeamCustomAdmin[] }> {
  const [members, access] = await Promise.all([
    prisma.chatMember.findMany({
      where: { chatId, status: { in: ["CREATOR", "ADMINISTRATOR"] } },
      include: { user: true },
      orderBy: [{ status: "asc" }, { user: { displayName: "asc" } }]
    }),
    prisma.chatAdminAccess.findMany({
      where: { chatId },
      include: { admin: true },
      orderBy: { createdAt: "asc" }
    })
  ]);

  return {
    native: members.map((member) => ({
      membershipId: member.id,
      telegramUserId: member.user.telegramUserId.toString(),
      telegramUserDbId: member.user.id,
      displayName: member.user.displayName,
      username: member.user.username,
      status: member.status as "CREATOR" | "ADMINISTRATOR"
    })),
    custom: access.map((row) => ({
      accessId: row.id,
      adminId: row.adminId,
      displayName: row.admin.displayName,
      telegramUsername: row.admin.telegramUsername,
      role: row.role,
      grantedVia: row.grantedVia,
      createdAt: row.createdAt.toISOString()
    }))
  };
}

/**
 * Exact lookup pattern reused from member-service.ts/message-service.ts:
 * strip a leading "@", case-insensitive username match, or a purely numeric
 * handle treated as a telegramUserId. Returns null (never throws) so callers
 * decide how to surface "unknown" -- no pending-invite path exists.
 */
export async function resolveTelegramUserByHandle(handle: string) {
  const trimmed = handle.trim();
  if (!trimmed) return null;

  const stripped = trimmed.replace(/^@/, "");
  if (/^\d+$/.test(stripped)) {
    return prisma.telegramUser.findUnique({ where: { telegramUserId: BigInt(stripped) } });
  }

  return prisma.telegramUser.findFirst({
    where: { username: { equals: stripped, mode: "insensitive" } }
  });
}

/**
 * Resolves the handle; if the person isn't known to the bot, throws a typed
 * error (no pending-invite mechanism, per product decision). Full ("Владелец")
 * panel access is owner-only and only ever granted automatically from the
 * chat's real Telegram creator -- this manual path can only reach someone who
 * is currently a live Telegram admin of this exact chat, and can only give
 * them ADMIN or MODERATOR. If known and eligible, finds-or-creates a
 * CHAT-scoped AdminUser for them and upserts their ChatAdminAccess row.
 */
export async function grantChatAccessByUsername(input: {
  chatId: string;
  actingAdminId: string;
  handle: string;
  role: ChatAdminAccessRole;
}) {
  if (input.role === "OWNER") {
    throw new ChatAdminAccessError(
      "OWNER_ROLE_NOT_GRANTABLE",
      "Роль «Владелец» нельзя выдать вручную — её получает только реальный создатель чата в Telegram.",
      422
    );
  }

  const telegramUser = await resolveTelegramUserByHandle(input.handle);
  if (!telegramUser) {
    throw new ChatAdminAccessError(
      "TELEGRAM_USER_UNKNOWN",
      "Этот пользователь ещё не известен боту. Он должен хотя бы раз написать в чате или боту, прежде чем его можно будет добавить в команду.",
      422
    );
  }

  const membership = await prisma.chatMember.findFirst({
    where: { chatId: input.chatId, userId: telegramUser.id },
    select: { status: true }
  });
  if (!membership || (membership.status !== "CREATOR" && membership.status !== "ADMINISTRATOR")) {
    throw new ChatAdminAccessError(
      "NOT_CHAT_ADMIN",
      "Доступ к панели можно выдать только тому, кто сейчас администратор этого чата в Telegram — сначала назначьте его администратором в самой группе.",
      422
    );
  }

  const admin = await prisma.adminUser.upsert({
    where: { telegramUserId: telegramUser.telegramUserId },
    create: {
      scope: "CHAT",
      role: "VIEWER",
      email: null,
      passwordHash: null,
      displayName: telegramUser.displayName,
      telegramUserId: telegramUser.telegramUserId,
      telegramUsername: telegramUser.username,
      telegramFirstName: telegramUser.firstName
    },
    update: {
      telegramUsername: telegramUser.username,
      telegramFirstName: telegramUser.firstName
    }
  });

  const access = await prisma.$transaction(async (tx) => {
    const saved = await tx.chatAdminAccess.upsert({
      where: { chatId_adminId: { chatId: input.chatId, adminId: admin.id } },
      create: {
        chatId: input.chatId,
        adminId: admin.id,
        role: input.role,
        grantedVia: "MANUAL",
        grantedByAdminId: input.actingAdminId
      },
      update: {
        role: input.role,
        grantedByAdminId: input.actingAdminId
      }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        affectedUserId: telegramUser.id,
        source: "ADMIN",
        action: "CHAT_ADMIN_ACCESS_GRANTED",
        metadata: { role: input.role, telegramUsername: telegramUser.username }
      }
    });
    return saved;
  });

  return access;
}

export async function updateChatAccessRole(input: {
  chatId: string;
  actingAdminId: string;
  accessId: string;
  role: ChatAdminAccessRole;
}) {
  const existing = await prisma.chatAdminAccess.findUnique({ where: { id: input.accessId } });
  if (!existing || existing.chatId !== input.chatId) return null;

  // Only the owner can reach this (canManageChatTeam gates the whole feature),
  // so a matching adminId here always means "the owner is acting on their own
  // row" -- block it outright rather than let them accidentally demote or
  // lock themselves out.
  if (existing.adminId === input.actingAdminId) {
    throw new ChatAdminAccessError(
      "CANNOT_MODIFY_SELF",
      "Нельзя изменить собственный доступ к панели.",
      403
    );
  }
  if (input.role === "OWNER") {
    throw new ChatAdminAccessError(
      "OWNER_ROLE_NOT_GRANTABLE",
      "Роль «Владелец» нельзя выдать вручную — её получает только реальный создатель чата в Telegram.",
      422
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.chatAdminAccess.update({
      where: { id: input.accessId },
      data: { role: input.role }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CHAT_ADMIN_ACCESS_UPDATED",
        metadata: { accessId: input.accessId, role: input.role }
      }
    });
    return updated;
  });
}

export async function revokeChatAccess(input: {
  chatId: string;
  actingAdminId: string;
  accessId: string;
}) {
  const existing = await prisma.chatAdminAccess.findUnique({ where: { id: input.accessId } });
  if (!existing || existing.chatId !== input.chatId) return false;

  if (existing.adminId === input.actingAdminId) {
    throw new ChatAdminAccessError(
      "CANNOT_MODIFY_SELF",
      "Нельзя удалить собственный доступ к панели.",
      403
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.chatAdminAccess.delete({ where: { id: input.accessId } });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CHAT_ADMIN_ACCESS_REVOKED",
        metadata: { accessId: input.accessId }
      }
    });
  });

  return true;
}

/**
 * Keeps a self-registered admin's AUTO-granted chat access in sync with their
 * current cached CREATOR status. Full ("Владелец") panel access is deliberately
 * owner-only, so this only ever grants for chats where they're the live creator --
 * being promoted to a regular Telegram ADMINISTRATOR never grants panel access by
 * itself, the owner has to add that by hand on the Команда tab. ChatAdminAccess is
 * otherwise only ever granted once (at self-registration) and never automatically
 * revoked -- so a former owner (chat ownership transferred, or removed) would keep
 * their web-panel access forever unless someone remembers to revoke it by hand.
 * Called on every Telegram-bot login (not just first self-registration) to close
 * that gap. Never touches "MANUAL" grants -- those were added deliberately by the
 * owner and don't track Telegram status at all.
 */
export async function syncAutoChatAdminAccess(adminId: string, telegramUserId: bigint) {
  const [ownedChats, existingAutoAccess] = await Promise.all([
    prisma.chatMember.findMany({
      where: {
        user: { telegramUserId },
        status: "CREATOR",
        chat: { botLinks: { some: { status: { notIn: ["REMOVED", "DISABLED"] } } } }
      },
      select: { chatId: true }
    }),
    prisma.chatAdminAccess.findMany({
      where: { adminId, grantedVia: "AUTO" },
      select: { id: true, chatId: true }
    })
  ]);

  const ownedChatIds = new Set(ownedChats.map((membership) => membership.chatId));
  const existingChatIds = new Set(existingAutoAccess.map((access) => access.chatId));

  const toGrant = ownedChats.filter((membership) => !existingChatIds.has(membership.chatId));
  const toRevoke = existingAutoAccess.filter((access) => !ownedChatIds.has(access.chatId));

  if (toGrant.length === 0 && toRevoke.length === 0) return;

  await prisma.$transaction(async (tx) => {
    if (toGrant.length > 0) {
      await tx.chatAdminAccess.createMany({
        data: toGrant.map((membership) => ({
          chatId: membership.chatId,
          adminId,
          role: "OWNER",
          grantedVia: "AUTO"
        })),
        skipDuplicates: true
      });
    }
    if (toRevoke.length > 0) {
      await tx.chatAdminAccess.deleteMany({ where: { id: { in: toRevoke.map((access) => access.id) } } });
    }
    await tx.auditLog.create({
      data: {
        actingAdminId: adminId,
        source: "ADMIN",
        action: "CHAT_ADMIN_ACCESS_AUTO_SYNCED",
        metadata: { granted: toGrant.map((m) => m.chatId), revoked: toRevoke.map((a) => a.chatId) }
      }
    });
  });
}

/**
 * The scoping primitive every reader threads through: null (sentinel "no
 * filter, see everything") for a GLOBAL admin -- unchanged behavior -- or
 * the array of chat IDs a CHAT admin has access to.
 */
export async function listChatsForAdmin(adminId: string): Promise<string[] | null> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { scope: true } });
  if (!admin || admin.scope === "GLOBAL") return null;

  const access = await prisma.chatAdminAccess.findMany({ where: { adminId }, select: { chatId: true } });
  return access.map((row) => row.chatId);
}

const MODERATION_ADMIN_ROLES = ["OWNER", "ADMIN", "MODERATOR"] as const;

export async function canAdminModerateChat(
  admin: { id: string; scope: "GLOBAL" | "CHAT"; role: string; isActive: boolean },
  chatId: string
) {
  if (!admin.isActive) return false;
  if (admin.scope === "GLOBAL") {
    return (MODERATION_ADMIN_ROLES as readonly string[]).includes(admin.role);
  }
  const access = await prisma.chatAdminAccess.findUnique({
    where: { chatId_adminId: { chatId, adminId: admin.id } },
    select: { id: true }
  });
  return access !== null;
}

/** Telegram recipients for chat-scoped moderation cards. */
export async function listTelegramModeratorsForChat(chatId: string) {
  const admins = await prisma.adminUser.findMany({
    where: {
      isActive: true,
      telegramUserId: { not: null },
      OR: [
        { scope: "GLOBAL", role: { in: [...MODERATION_ADMIN_ROLES] } },
        { scope: "CHAT", chatAdminAccess: { some: { chatId } } }
      ]
    },
    select: { telegramUserId: true }
  });
  return admins.flatMap((admin) => admin.telegramUserId === null ? [] : [admin.telegramUserId]);
}
