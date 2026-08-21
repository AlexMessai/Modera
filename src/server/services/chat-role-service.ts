import { prisma } from "@/server/db/prisma";

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

const DEFAULT_ROLE_KEYS = Object.keys(DEFAULT_ROLE_DEFINITIONS) as DefaultRoleKey[];

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

  await prisma.chatMember.updateMany({
    where: {
      id: input.membershipId,
      chatRoleAssignedBy: { not: "MANUAL" },
      NOT: { chatRoleId: role.id }
    },
    data: { chatRoleId: role.id, chatRoleAssignedBy: "AUTO" }
  });
}

/**
 * Resolves a Telegram user's permission set in a chat purely from the
 * ChatRole assignment — no live Telegram call, no fallback. Not yet wired
 * into any bot-side authorization decision (see telegram-admin-service.ts's
 * isLiveTelegramChatAdmin, still the actual gate) — this is Phase 1's
 * additive half; the switch-over is a separate, later change.
 */
export async function resolveChatPermissions(chatId: string, telegramUserId: number): Promise<Set<ChatPermission>> {
  const member = await prisma.chatMember.findFirst({
    where: { chatId, user: { telegramUserId: BigInt(telegramUserId) } },
    select: { chatRole: { select: { permissions: true } } }
  });
  const permissions = member?.chatRole?.permissions ?? [];
  return new Set(permissions.filter(isChatPermission));
}
