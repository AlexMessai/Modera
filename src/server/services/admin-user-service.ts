import bcrypt from "bcryptjs";
import { prisma } from "@/server/db/prisma";
import type { AdminRoleValue } from "@/server/auth/permissions";
import { syncAutoChatAdminAccess } from "@/server/services/chat-admin-access-service";

export class AdminUserError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "AdminUserError";
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function assertPassword(password: string) {
  if (password.length < 12) {
    throw new AdminUserError(
      "PASSWORD_TOO_SHORT",
      "Пароль должен содержать минимум 12 символов.",
      400
    );
  }
}

export async function listAdminUsers() {
  const now = new Date();
  const users = await prisma.adminUser.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: {
      _count: {
        select: {
          sessions: {
            where: { expiresAt: { gt: now } }
          }
        }
      }
    }
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    telegramUsername: user.telegramUsername,
    telegramFirstName: user.telegramFirstName,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    activeSessionCount: user._count.sessions,
    telegramLinked: user.telegramUserId !== null
  }));
}

export async function createAdminUser(input: {
  actingAdminId: string;
  email: string;
  displayName: string;
  role: AdminRoleValue;
  password: string;
}) {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  assertPassword(input.password);

  if (!email || !displayName) {
    throw new AdminUserError(
      "INVALID_ADMIN",
      "Укажите имя и email администратора.",
      400
    );
  }

  const existing = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true }
  });
  if (existing) {
    throw new AdminUserError(
      "EMAIL_ALREADY_EXISTS",
      "Администратор с таким email уже существует.",
      409
    );
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.adminUser.create({
      data: {
        email,
        displayName,
        passwordHash,
        role: input.role,
        isActive: true
      }
    });

    await tx.auditLog.create({
      data: {
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "ADMIN_ACCOUNT_CREATED",
        metadata: {
          affectedAdminId: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role
        }
      }
    });

    return user;
  });

  return {
    id: created.id,
    email: created.email,
    displayName: created.displayName,
    role: created.role,
    isActive: created.isActive,
    lastLoginAt: created.lastLoginAt?.toISOString() ?? null,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    activeSessionCount: 0
  };
}

export async function updateAdminUser(input: {
  actingAdminId: string;
  targetAdminId: string;
  email?: string;
  displayName?: string;
  role?: AdminRoleValue;
  isActive?: boolean;
  newPassword?: string;
}) {
  if (input.newPassword) assertPassword(input.newPassword);

  const passwordHash = input.newPassword
    ? await bcrypt.hash(input.newPassword, 12)
    : undefined;

  return prisma.$transaction(async (tx) => {
    const current = await tx.adminUser.findUnique({
      where: { id: input.targetAdminId }
    });
    if (!current) {
      throw new AdminUserError(
        "ADMIN_NOT_FOUND",
        "Администратор не найден.",
        404
      );
    }

    const nextEmail = input.email !== undefined
      ? normalizeEmail(input.email)
      : current.email;
    const nextDisplayName = input.displayName !== undefined
      ? input.displayName.trim()
      : current.displayName;
    const nextRole = input.role ?? current.role;
    const nextActive = input.isActive ?? current.isActive;

    if (!nextEmail || !nextDisplayName) {
      throw new AdminUserError(
        "INVALID_ADMIN",
        "Имя и email не могут быть пустыми.",
        400
      );
    }

    if (input.actingAdminId === current.id && !nextActive) {
      throw new AdminUserError(
        "SELF_DEACTIVATION_FORBIDDEN",
        "Нельзя отключить собственную учётную запись.",
        409
      );
    }

    if (input.actingAdminId === current.id && nextRole !== current.role) {
      throw new AdminUserError(
        "SELF_ROLE_CHANGE_FORBIDDEN",
        "Нельзя изменить роль собственной учётной записи.",
        409
      );
    }

    if (nextEmail !== current.email) {
      const duplicate = await tx.adminUser.findUnique({
        where: { email: nextEmail },
        select: { id: true }
      });
      if (duplicate) {
        throw new AdminUserError(
          "EMAIL_ALREADY_EXISTS",
          "Администратор с таким email уже существует.",
          409
        );
      }
    }

    const removesActiveOwner =
      current.role === "OWNER" &&
      current.isActive &&
      (nextRole !== "OWNER" || !nextActive);

    if (removesActiveOwner) {
      const otherActiveOwners = await tx.adminUser.count({
        where: {
          id: { not: current.id },
          role: "OWNER",
          isActive: true
        }
      });
      if (otherActiveOwners === 0) {
        throw new AdminUserError(
          "LAST_OWNER_PROTECTED",
          "Нельзя отключить или понизить последнего активного владельца.",
          409
        );
      }
    }

    const updated = await tx.adminUser.update({
      where: { id: current.id },
      data: {
        email: nextEmail,
        displayName: nextDisplayName,
        role: nextRole,
        isActive: nextActive,
        ...(passwordHash ? { passwordHash } : {})
      }
    });

    const shouldRevokeSessions = Boolean(passwordHash) || !nextActive;
    if (shouldRevokeSessions) {
      await tx.adminSession.deleteMany({
        where: { adminId: current.id }
      });
    }

    await tx.auditLog.create({
      data: {
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "ADMIN_ACCOUNT_UPDATED",
        metadata: {
          affectedAdminId: current.id,
          before: {
            email: current.email,
            displayName: current.displayName,
            role: current.role,
            isActive: current.isActive
          },
          after: {
            email: updated.email,
            displayName: updated.displayName,
            role: updated.role,
            isActive: updated.isActive
          },
          passwordChanged: Boolean(passwordHash),
          sessionsRevoked: shouldRevokeSessions
        }
      }
    });

    return {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      role: updated.role,
      isActive: updated.isActive,
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      activeSessionCount: shouldRevokeSessions
        ? 0
        : await tx.adminSession.count({
            where: {
              adminId: updated.id,
              expiresAt: { gt: new Date() }
            }
          })
    };
  });
}

export async function revokeAdminSessions(input: {
  actingAdminId: string;
  targetAdminId: string;
}) {
  const target = await prisma.adminUser.findUnique({
    where: { id: input.targetAdminId },
    select: { id: true, email: true, displayName: true }
  });
  if (!target) {
    throw new AdminUserError(
      "ADMIN_NOT_FOUND",
      "Администратор не найден.",
      404
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.adminSession.deleteMany({
      where: { adminId: target.id }
    });
    await tx.auditLog.create({
      data: {
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "ADMIN_SESSIONS_REVOKED",
        metadata: {
          affectedAdminId: target.id,
          email: target.email,
          revokedSessionCount: deleted.count
        }
      }
    });
    return deleted.count;
  });

  return { revokedSessionCount: result };
}

export type TelegramIdentityResolution =
  | { outcome: "ok"; admin: NonNullable<Awaited<ReturnType<typeof prisma.adminUser.findUnique>>> }
  | { outcome: "not_linked" }
  | { outcome: "no_admin_chats" };

/**
 * Shared by every "log in as whoever this Telegram identity is" entry point
 * (today: the /login page's bot-deep-link flow, telegram-login-request-service.ts) --
 * kept as one implementation so self-registration behaves identically everywhere it
 * can happen. An existing, active AdminUser with this telegramUserId just resolves to
 * itself (re-syncing its AUTO chat access, see syncAutoChatAdminAccess). Otherwise,
 * self-registers a new CHAT-scoped account IF this Telegram user is the live CREATOR
 * of at least one chat the bot is still present in (cached ChatMember status, not a
 * live Bot API fan-out) -- full panel access is deliberately owner-only; a chat's
 * other Telegram admins/moderators never get it automatically, the owner has to grant
 * it by hand on that chat's Команда tab.
 */
export async function resolveOrCreateAdminFromTelegramIdentity(telegramUser: {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}): Promise<TelegramIdentityResolution> {
  const telegramUserId = BigInt(telegramUser.id);
  const existing = await prisma.adminUser.findUnique({ where: { telegramUserId } });

  if (existing && !existing.isActive) {
    return { outcome: "not_linked" };
  }
  if (existing) {
    if (existing.scope === "CHAT") {
      await syncAutoChatAdminAccess(existing.id, telegramUserId).catch(() => undefined);
    }
    return { outcome: "ok", admin: existing };
  }

  const ownedChats = await prisma.chatMember.findMany({
    where: {
      user: { telegramUserId },
      status: "CREATOR",
      chat: { botLinks: { some: { status: { notIn: ["REMOVED", "DISABLED"] } } } }
    },
    select: { chatId: true }
  });

  if (ownedChats.length === 0) {
    return { outcome: "no_admin_chats" };
  }

  const created = await prisma.$transaction(async (tx) => {
    const newAdmin = await tx.adminUser.create({
      data: {
        scope: "CHAT",
        role: "VIEWER",
        email: null,
        passwordHash: null,
        displayName: [telegramUser.firstName, telegramUser.lastName].filter(Boolean).join(" ").trim() || telegramUser.username || `Telegram ${telegramUser.id}`,
        telegramUserId,
        telegramUsername: telegramUser.username ?? null,
        telegramFirstName: telegramUser.firstName ?? null,
        isActive: true
      }
    });

    await tx.chatAdminAccess.createMany({
      data: ownedChats.map((membership) => ({
        chatId: membership.chatId,
        adminId: newAdmin.id,
        role: "OWNER",
        grantedVia: "AUTO"
      }))
    });

    await tx.auditLog.create({
      data: {
        actingAdminId: newAdmin.id,
        source: "ADMIN",
        action: "ADMIN_ACCOUNT_SELF_REGISTERED",
        metadata: { chatCount: ownedChats.length, telegramUsername: telegramUser.username ?? null }
      }
    });

    return newAdmin;
  });

  return { outcome: "ok", admin: created };
}
