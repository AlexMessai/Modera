import type { TelegramChatMember } from "@/server/telegram/types";

export type NormalizedBotStatus =
  | "ACTIVE"
  | "CONNECTED"
  | "NOT_ADMIN"
  | "INSUFFICIENT_PERMISSIONS"
  | "REMOVED"
  | "DISABLED"
  | "TELEGRAM_ERROR";

export function extractBotPermissions(member: TelegramChatMember) {
  if (member.status !== "administrator" && member.status !== "creator") {
    return {
      canManageChat: false,
      canDeleteMessages: false,
      canRestrictMembers: false,
      canInviteUsers: false,
      canPinMessages: false,
      canManageTopics: false
    };
  }

  return {
    canManageChat: member.status === "creator" || Boolean(member.can_manage_chat),
    canDeleteMessages: member.status === "creator" || Boolean(member.can_delete_messages),
    canRestrictMembers: member.status === "creator" || Boolean(member.can_restrict_members),
    canInviteUsers: member.status === "creator" || Boolean(member.can_invite_users),
    canPinMessages: member.status === "creator" || Boolean(member.can_pin_messages),
    canManageTopics: member.status === "creator" || Boolean(member.can_manage_topics)
  };
}

export function deriveBotStatus(member: TelegramChatMember): NormalizedBotStatus {
  if (member.status === "left" || member.status === "kicked") {
    return "REMOVED";
  }

  if (member.status === "member" || member.status === "restricted") {
    return "NOT_ADMIN";
  }

  if (member.status === "administrator" || member.status === "creator") {
    const permissions = extractBotPermissions(member);
    const canModerate = permissions.canDeleteMessages && permissions.canRestrictMembers;
    return canModerate ? "ACTIVE" : "INSUFFICIENT_PERMISSIONS";
  }

  return "CONNECTED";
}
