export const MODERATION_ROLES = ["OWNER", "ADMIN", "MODERATOR"] as const;

export type AdminRoleValue = "OWNER" | "ADMIN" | "MODERATOR" | "VIEWER";

export function canModerate(role: string): role is (typeof MODERATION_ROLES)[number] {
  return MODERATION_ROLES.includes(role as (typeof MODERATION_ROLES)[number]);
}
