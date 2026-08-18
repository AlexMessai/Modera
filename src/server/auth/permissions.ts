export const MODERATION_ROLES = ["OWNER", "ADMIN", "MODERATOR"] as const;
export const CHAT_SETTINGS_ROLES = ["OWNER", "ADMIN"] as const;
export const SYSTEM_ROLES = ["OWNER", "ADMIN"] as const;
export const RECONCILIATION_ROLES = ["OWNER", "ADMIN"] as const;
export const ADMIN_MANAGEMENT_ROLES = ["OWNER"] as const;

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

export function canReconcileModeration(
  role: string
): role is (typeof RECONCILIATION_ROLES)[number] {
  return RECONCILIATION_ROLES.includes(role as (typeof RECONCILIATION_ROLES)[number]);
}

export function canManageAdmins(
  role: string
): role is (typeof ADMIN_MANAGEMENT_ROLES)[number] {
  return ADMIN_MANAGEMENT_ROLES.includes(role as (typeof ADMIN_MANAGEMENT_ROLES)[number]);
}