export const MODERATION_ROLES = ["OWNER", "ADMIN", "MODERATOR"] as const;
export const CHAT_SETTINGS_ROLES = ["OWNER", "ADMIN"] as const;
export const SYSTEM_ROLES = ["OWNER", "ADMIN"] as const;

export type AdminRoleValue = "OWNER" | "ADMIN" | "MODERATOR" | "VIEWER";

export function canModerate(role: string): role is (typeof MODERATION_ROLES)[number] {
  return MODERATION_ROLES.includes(role as (typeof MODERATION_ROLES)[number]);
}

export function canManageChatSettings(
  role: string
): role is (typeof CHAT_SETTINGS_ROLES)[number] {
  return CHAT_SETTINGS_ROLES.includes(role as (typeof CHAT_SETTINGS_ROLES)[number]);
}

export function canViewSystem(role: string): role is (typeof SYSTEM_ROLES)[number] {
  return SYSTEM_ROLES.includes(role as (typeof SYSTEM_ROLES)[number]);
}
