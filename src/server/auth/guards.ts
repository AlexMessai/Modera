import { redirect } from "next/navigation";
import { canModerate } from "@/server/auth/permissions";
import { getCurrentAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

type CurrentAdmin = NonNullable<Awaited<ReturnType<typeof getCurrentAdmin>>>;

export async function requireAdminPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");
  return admin;
}

export async function requireAdminApi() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return {
      ok: false as const,
      response: Response.json(
        { error: { code: "UNAUTHORIZED", message: "Требуется авторизация." } },
        { status: 401 }
      )
    };
  }

  return { ok: true as const, admin };
}

export async function requireModerationApi() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth;

  if (!canModerate(auth.admin.role)) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "У вашей роли нет прав на действия модерации."
          }
        },
        { status: 403 }
      )
    };
  }

  return { ok: true as const, admin: auth.admin };
}

/**
 * Global configuration, diagnostics and account-management endpoints must
 * never infer authority from `role` alone. CHAT accounts deliberately keep
 * an inert global role, but this explicit scope gate prevents a malformed or
 * manually-edited account from crossing the global boundary.
 */
export function requireGlobalAdminAccess(admin: CurrentAdmin) {
  if (admin.scope === "GLOBAL") return { ok: true as const };
  return {
    ok: false as const,
    response: Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Доступно только глобальным администраторам Modera."
        }
      },
      { status: 403 }
    )
  };
}

async function hasChatAccess(admin: CurrentAdmin, chatId: string): Promise<boolean> {
  if (admin.scope === "GLOBAL") return true;
  const access = await prisma.chatAdminAccess.findUnique({
    where: { chatId_adminId: { chatId, adminId: admin.id } },
    select: { id: true }
  });
  return access !== null;
}

/**
 * GLOBAL admins pass through unconditionally (current behavior preserved
 * exactly). A CHAT-scoped admin without a ChatAdminAccess row for this chat
 * is treated as **not found**, not forbidden -- matching the existing
 * honest-404 convention elsewhere, so a scoped admin can't probe for a
 * chat's existence. Call right after requireAdminApi()/requireAdminPage():
 * API routes do `if (!auth.ok) return auth.response;`, pages do
 * `if (!auth.ok) notFound();`.
 */
export async function requireChatAccess(admin: CurrentAdmin, chatId: string) {
  const ok = await hasChatAccess(admin, chatId);
  if (!ok) {
    return {
      ok: false as const,
      response: Response.json(
        { error: { code: "NOT_FOUND", message: "Чат не найден." } },
        { status: 404 }
      )
    };
  }
  return { ok: true as const };
}

/**
 * User-scoped resources such as Telegram avatars may be shown to a CHAT
 * admin only when the user belongs to at least one chat visible to that
 * admin. Returning the same honest 404 as requireChatAccess prevents UUID
 * probing across tenants.
 */
export async function requireTelegramUserAccess(admin: CurrentAdmin, userId: string) {
  if (admin.scope === "GLOBAL") return { ok: true as const };

  const membership = await prisma.chatMember.findFirst({
    where: {
      userId,
      chat: { adminAccess: { some: { adminId: admin.id } } }
    },
    select: { id: true }
  });
  if (!membership) {
    return {
      ok: false as const,
      response: Response.json(
        { error: { code: "NOT_FOUND", message: "Пользователь не найден." } },
        { status: 404 }
      )
    };
  }
  return { ok: true as const };
}

/**
 * The role to evaluate `canManageChatSettings`/`canModerate` against for a
 * *specific chat*. GLOBAL admins pass through unchanged -- byte-for-byte the
 * same `admin.role` value used today, zero behavior change. CHAT admins get
 * their `ChatAdminAccess.role` for that chat (already the same
 * OWNER/ADMIN/MODERATOR vocabulary those permission checks expect), or
 * "VIEWER" if no row exists -- a defensive fallback that should be
 * unreachable in practice since `requireChatAccess` already guarantees a row
 * exists on every real code path.
 */
export async function resolveEffectiveChatRole(
  admin: CurrentAdmin,
  chatId: string
): Promise<"OWNER" | "ADMIN" | "MODERATOR" | "VIEWER"> {
  if (admin.scope === "GLOBAL") return admin.role;

  const access = await prisma.chatAdminAccess.findUnique({
    where: { chatId_adminId: { chatId, adminId: admin.id } },
    select: { role: true }
  });
  return access?.role ?? "VIEWER";
}

/**
 * Granting web-panel access to other people is more sensitive than editing
 * automod settings, so within CHAT scope it's OWNER-only (not ADMIN too,
 * unlike canManageChatSettings' GLOBAL-scope semantics which this mirrors
 * for GLOBAL OWNER/ADMIN).
 */
export async function canManageChatTeam(admin: CurrentAdmin, chatId: string): Promise<boolean> {
  if (admin.scope === "GLOBAL") {
    return admin.role === "OWNER" || admin.role === "ADMIN";
  }
  const access = await prisma.chatAdminAccess.findUnique({
    where: { chatId_adminId: { chatId, adminId: admin.id } },
    select: { role: true }
  });
  return access?.role === "OWNER";
}
