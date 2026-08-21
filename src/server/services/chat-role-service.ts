import { prisma } from "@/server/db/prisma";
import { isLiveTelegramChatAdmin } from "@/server/services/telegram-admin-service";

/**
 * BOT_PRODUCT_SPEC_FINAL_UPDATED.md §34 — "Role = collection of permissions",
 * independent of the role's name. This is the full fixed vocabulary; a
 * ChatRole's `permissions` field is always a subset of these strings.
 */
export const CHAT_PERMISSIONS = [
  "moderation.warn",
  "moderation.mute",
  "moderation.ban",
  "moderation.kick",
  "moderation.delete",
  "users.view",
  "history.view",
  "automod.manage",
  "settings.manage",
  "roles.manage",
  "logs.view"
] as const;

export type ChatPermission = (typeof CHAT_PERMISSIONS)[number];

export function isChatPermission(value: string): value is ChatPermission {
  return (CHAT_PERMISSIONS as readonly string[]).includes(value);
}

export const CHAT_PERMISSION_LABELS: Record<ChatPermission, string> = {
  "moderation.warn": "Выдавать предупреждения",
  "moderation.mute": "Ограничивать (mute)",
  "moderation.ban": "Блокировать (ban)",
  "moderation.kick": "Исключать (kick)",
  "moderation.delete": "Удалять сообщения",
  "users.view": "Просматривать участников",
  "history.view": "Просматривать историю",
  "automod.manage": "Управлять автомодерацией",
  "settings.manage": "Управлять настройками чата",
  "roles.manage": "Управлять ролями",
  "logs.view": "Просматривать журнал"
};

export type DefaultRoleKey = "owner" | "admin" | "moderator" | "trusted" | "member";

const ALL_MODERATION_PERMISSIONS: ChatPermission[] = [
  "moderation.warn",
  "moderation.mute",
  "moderation.ban",
  "moderation.kick",
  "moderation.delete"
];

/**
 * Seeded per chat by ensureDefaultRolesForChat. Owner/Admin/Moderator differ
 * only in which non-moderation capabilities they carry — Telegram itself
 * doesn't distinguish "creator" from "administrator" much further than this
 * for our purposes. Trusted/Member start with no permissions: Trusted's
 * actual effect (automod bypass) is a separate, existing mechanism
 * (ChatMember.internalRole, see trusted-member-service.ts) that this role
 * currently just mirrors for display — not yet unified, see project notes.
 */
export const DEFAULT_ROLE_DEFINITIONS: Record<DefaultRoleKey, { label: string; permissions: ChatPermission[] }> = {
  owner: {
    label: "Владелец",
    permissions: [...ALL_MODERATION_PERMISSIONS, "users.view", "history.view", "automod.manage", "settings.manage", "roles.manage", "logs.view"]
  },
  admin: {
    label: "Администратор",
    permissions: [...ALL_MODERATION_PERMISSIONS, "users.view", "history.view", "automod.manage", "settings.manage", "logs.view"]
  },
  moderator: {
    label: "Модератор",
    permissions: [...ALL_MODERATION_PERMISSIONS, "users.view", "history.view", "logs.view"]
  },
  trusted: { label: "Доверенный", permissions: [] },
  member: { label: "Участник", permissions: [] }
};

export const DEFAULT_ROLE_KEYS = Object.keys(DEFAULT_ROLE_DEFINITIONS) as DefaultRoleKey[];

/** Idempotent — safe to call on every membership sync; only writes when a default role row is actually missing. */
export async function ensureDefaultRolesForChat(chatId: string) {
  const existing = await prisma.chatRole.findMany({
    where: { chatId, isCustom: false },
    select: { key: true }
  });
  const existingKeys = new Set(existing.map((role) => role.key));
  const missing = DEFAULT_ROLE_KEYS.filter((key) => !existingKeys.has(key));
  if (missing.length === 0) return;

  await prisma.chatRole.createMany({
    data: missing.map((key) => ({
      chatId,
      key,
      label: DEFAULT_ROLE_DEFINITIONS[key].label,
      isCustom: false,
      permissions: DEFAULT_ROLE_DEFINITIONS[key].permissions
    })),
    skipDuplicates: true
  });
}

export type ChatRoleSummary = {
  id: string;
  key: string;
  label: string;
  isCustom: boolean;
  permissions: ChatPermission[];
};

const DEFAULT_ROLE_ORDER = new Map<string, number>(DEFAULT_ROLE_KEYS.map((key, index) => [key, index]));

/** Ensures the 5 defaults exist, then returns every role for this chat (defaults first, in a fixed order; any future custom roles after). */
export async function listChatRoles(chatId: string): Promise<ChatRoleSummary[]> {
  // Guards against a bogus/nonexistent chatId, e.g. a page.tsx caller that
  // hasn't yet checked its own profile lookup -- ensureDefaultRolesForChat's
  // createMany would otherwise throw on the FK constraint instead of just
  // returning nothing.
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { id: true } });
  if (!chat) return [];

  await ensureDefaultRolesForChat(chatId);
  const roles = await prisma.chatRole.findMany({ where: { chatId } });
  return roles
    .map((role) => ({
      id: role.id,
      key: role.key,
      label: role.label,
      isCustom: role.isCustom,
      permissions: role.permissions.filter(isChatPermission)
    }))
    .sort((a, b) => (DEFAULT_ROLE_ORDER.get(a.key) ?? 99) - (DEFAULT_ROLE_ORDER.get(b.key) ?? 99));
}

/**
 * Phase 9: the first write path for ChatRole.permissions since Phase 1 seeded
 * it read-only. Not permission-gated by ChatPermission itself (that would be
 * circular for the role editing its own "roles.manage") -- callers gate via
 * the same admin-role/chat-permission check used for every other settings
 * surface (canManageChatSettings for Web Admin, "automod.manage" for
 * /settings, matching precedent).
 */
export async function updateChatRolePermissions(input: {
  chatId: string;
  roleId: string;
  actingAdminId: string;
  permissions: ChatPermission[];
}): Promise<ChatRoleSummary | null> {
  const role = await prisma.chatRole.findUnique({ where: { id: input.roleId } });
  if (!role || role.chatId !== input.chatId) return null;

  const permissions = Array.from(new Set(input.permissions.filter(isChatPermission)));
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.chatRole.update({
      where: { id: input.roleId },
      data: { permissions }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CHAT_ROLE_UPDATED",
        metadata: { roleKey: role.key, roleLabel: role.label, permissions }
      }
    });
    return updated;
  });

  return {
    id: saved.id,
    key: saved.key,
    label: saved.label,
    isCustom: saved.isCustom,
    permissions: saved.permissions.filter(isChatPermission)
  };
}

function autoRoleKeyForMember(status: string, isTrusted: boolean): DefaultRoleKey {
  if (isTrusted) return "trusted";
  if (status === "CREATOR") return "owner";
  if (status === "ADMINISTRATOR") return "admin";
  return "member";
}

/**
 * Keeps a member's ChatRole in sync with their live Telegram status —
 * called from member-service.ts on every observed membership update, and
 * from trusted-member-service.ts right after a trusted toggle (rather than
 * waiting for the next Telegram event to catch up). `isTrusted` is passed
 * in rather than read from ChatMember.internalRole here, so this module
 * doesn't need to import trusted-member-service.ts (which would otherwise
 * import this one back, for TRUSTED_INTERNAL_ROLE).
 *
 * Never overrides a role an admin assigned by hand (`chatRoleAssignedBy ===
 * "MANUAL"`); Phase 1 has no UI for manual assignment yet, so today this is
 * always a no-op guard, not yet exercised, but the column/check exist now so
 * manual assignment (Phase 9 UI) doesn't need a data migration later.
 */
export async function syncAutoChatRole(input: {
  chatId: string;
  membershipId: string;
  status: string;
  isTrusted: boolean;
}) {
  await ensureDefaultRolesForChat(input.chatId);
  const targetKey = autoRoleKeyForMember(input.status, input.isTrusted);
  const role = await prisma.chatRole.findUnique({
    where: { chatId_key: { chatId: input.chatId, key: targetKey } }
  });
  if (!role) return;

  // Expressed as a positive OR (unset, or previously AUTO) rather than
  // `{ not: "MANUAL" }` — Prisma/Postgres's `not` on a nullable column
  // doesn't match NULL rows (SQL's NULL != 'MANUAL' is unknown, not true),
  // so a fresh member who's never had a role assigned would otherwise never
  // get one — caught by chat-role-service.test.ts.
  await prisma.chatMember.updateMany({
    where: {
      id: input.membershipId,
      OR: [{ chatRoleAssignedBy: null }, { chatRoleAssignedBy: "AUTO" }]
    },
    data: { chatRoleId: role.id, chatRoleAssignedBy: "AUTO" }
  });
}

/**
 * Resolves a Telegram user's permission set in a chat purely from the
 * ChatRole assignment — no live Telegram call, no fallback.
 */
export async function resolveChatPermissions(chatId: string, telegramUserId: number): Promise<Set<ChatPermission>> {
  const member = await prisma.chatMember.findFirst({
    where: { chatId, user: { telegramUserId: BigInt(telegramUserId) } },
    select: { chatRole: { select: { permissions: true } } }
  });
  const permissions = member?.chatRole?.permissions ?? [];
  return new Set(permissions.filter(isChatPermission));
}

// Permissions any live Telegram chat admin already has today, independent
// of role data — every command currently gated by isLiveTelegramChatAdmin
// covers one of these. history.view/users.view are included alongside the
// moderation.* actions because /warns (a read-only lookup) is gated the
// same way the mutating commands are; not every ChatPermission gets this
// fallback (settings.manage/roles.manage/automod.manage/logs.view are web-
// panel-only today and stay role-only, no live-admin bypass).
const LIVE_ADMIN_FALLBACK_PERMISSIONS = new Set<ChatPermission>([
  ...ALL_MODERATION_PERMISSIONS,
  "history.view",
  "users.view"
]);

/**
 * Phase 1b — the actual authorization decision for bot-side moderation
 * commands, replacing a bare isLiveTelegramChatAdmin check.
 *
 * ChatRole can currently only GRANT a moderation permission beyond what
 * live Telegram admin status already allows (e.g. a custom "Moderator" role
 * for someone who isn't a Telegram admin at all) — it can't yet RESTRICT a
 * live Telegram admin's native rights below that. Doing so safely would
 * require this member's role to be guaranteed fresh at decision time (an
 * extra live Telegram call per command to catch a very recent promotion/
 * demotion), rather than relying on the periodic admin-list sync
 * (BOT_CHAT_REFRESH_MS, ~5 min) — deferred until that's actually needed;
 * flagged here rather than silently assumed away.
 */
export async function hasChatPermission(input: {
  chatId: string;
  chatTelegramId: number;
  telegramUserId: number;
  permission: ChatPermission;
}): Promise<boolean> {
  const rolePermissions = await resolveChatPermissions(input.chatId, input.telegramUserId);
  if (rolePermissions.has(input.permission)) return true;
  if (!LIVE_ADMIN_FALLBACK_PERMISSIONS.has(input.permission)) return false;
  return isLiveTelegramChatAdmin(input.chatTelegramId, input.telegramUserId);
}
