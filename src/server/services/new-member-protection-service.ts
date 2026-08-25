import { prisma } from "@/server/db/prisma";
import { resolveEffectiveCaptchaSettings } from "@/server/services/captcha-settings-service";
import { resolveEffectiveContentSettings, type ContentSettingsValue } from "@/server/services/content-settings-service";
import { getTelegramClient, MUTED_CHAT_PERMISSIONS } from "@/server/telegram/client";
import type { TelegramUser } from "@/server/telegram/types";

const RTL_NAME_PATTERN = /[\u0590-\u08ff\ufb1d-\ufefc]/u;

function fullName(user: TelegramUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
}

function matchesConfiguredPattern(name: string, patterns: string[]) {
  const normalized = name.toLocaleLowerCase("ru-RU");
  return patterns.some((pattern) => {
    if (pattern.startsWith("r:")) {
      try { return new RegExp(pattern.slice(2), "iu").test(name); } catch { return false; }
    }
    return normalized.includes(pattern.toLocaleLowerCase("ru-RU"));
  });
}

export function newMemberBlockReason(settings: ContentSettingsValue, user: TelegramUser, viaChatFolderInviteLink = false) {
  const name = fullName(user);
  if (user.is_bot && settings.blockInvitedBots) return "INVITED_BOT";
  if (settings.blockChatFolderJoins && viaChatFolderInviteLink) return "CHAT_FOLDER_JOIN";
  if (settings.blockRtlNames && RTL_NAME_PATTERN.test(name)) return "RTL_NAME";
  if (settings.blockMissingUsername && !user.username) return "MISSING_USERNAME";
  if (settings.maxNameLength > 0 && name.length > settings.maxNameLength) return "NAME_TOO_LONG";
  if (settings.blockedNamePatterns.length && matchesConfiguredPattern(name, settings.blockedNamePatterns)) return "BLOCKED_NAME_PATTERN";
  return null;
}

export async function applyNewMemberProtection(input: {
  chatId: string;
  membershipId: string;
  userId: string;
  telegramChatId: bigint;
  user: TelegramUser;
  joinedAt: Date;
  viaChatFolderInviteLink?: boolean;
}) {
  const [{ settings }, captcha] = await Promise.all([
    resolveEffectiveContentSettings(input.chatId),
    resolveEffectiveCaptchaSettings(input.chatId)
  ]);
  const reason = newMemberBlockReason(settings, input.user, input.viaChatFolderInviteLink);
  const client = getTelegramClient();

  if (reason) {
    const until = Math.floor(Date.now() / 1000) + 60;
    const now = new Date();
    await client.banChatMember({ chatId: Number(input.telegramChatId), userId: input.user.id, untilDate: until, revokeMessages: true });
    await prisma.$transaction([
      prisma.chatMember.update({ where: { id: input.membershipId }, data: { status: "BANNED", punishmentState: "BANNED", punishmentExpiresAt: new Date(until * 1000), lastModerationAt: now } }),
      prisma.auditLog.create({ data: { chatId: input.chatId, affectedUserId: input.userId, source: "SYSTEM", action: "NEW_MEMBER_BLOCKED", reason, metadata: { reason } } }),
      // A real punitive action against a member -- recorded here (not just AuditLog)
      // so it shows up in the member's moderation history like every other ban.
      prisma.moderationAction.create({ data: { chatId: input.chatId, affectedUserId: input.userId, source: "SYSTEM", type: "BAN", status: "SUCCEEDED", reason, expiresAt: new Date(until * 1000), completedAt: now, metadata: { reason, trigger: "NEW_MEMBER_PROTECTION" } } })
    ]);
    return { outcome: "blocked" as const, reason };
  }

  if (settings.muteNewMembersMinutes > 0 && !captcha.settings.enabled) {
    const untilDate = new Date(input.joinedAt.getTime() + settings.muteNewMembersMinutes * 60_000);
    const now = new Date();
    await client.restrictChatMember({ chatId: Number(input.telegramChatId), userId: input.user.id, permissions: MUTED_CHAT_PERMISSIONS, untilDate: Math.floor(untilDate.getTime() / 1000) });
    await prisma.$transaction([
      prisma.chatMember.update({ where: { id: input.membershipId }, data: { status: "RESTRICTED", punishmentState: "MUTED", punishmentExpiresAt: untilDate, lastModerationAt: now } }),
      prisma.auditLog.create({ data: { chatId: input.chatId, affectedUserId: input.userId, source: "SYSTEM", action: "NEW_MEMBER_MUTED", metadata: { durationMinutes: settings.muteNewMembersMinutes } } }),
      prisma.moderationAction.create({ data: { chatId: input.chatId, affectedUserId: input.userId, source: "SYSTEM", type: "MUTE", status: "SUCCEEDED", expiresAt: untilDate, completedAt: now, metadata: { durationMinutes: settings.muteNewMembersMinutes, trigger: "NEW_MEMBER_PROTECTION" } } })
    ]);
    return { outcome: "muted" as const };
  }

  return { outcome: "allowed" as const };
}

export async function reviewExistingMembers(chatId: string) {
  const [{ settings }, chat, memberships] = await Promise.all([
    resolveEffectiveContentSettings(chatId),
    prisma.chat.findUnique({ where: { id: chatId }, select: { telegramChatId: true } }),
    prisma.chatMember.findMany({
      where: { chatId, status: { in: ["MEMBER", "RESTRICTED"] }, internalRole: { not: "TRUSTED" } },
      include: { user: true },
      take: 500
    })
  ]);
  if (!settings.checkExistingMembers || !chat) return { checked: 0, blocked: 0 };
  let blocked = 0;
  for (const membership of memberships) {
    const user: TelegramUser = { id: Number(membership.user.telegramUserId), is_bot: membership.user.isBot, first_name: membership.user.firstName, last_name: membership.user.lastName ?? undefined, username: membership.user.username ?? undefined };
    const reason = newMemberBlockReason(settings, user);
    if (!reason) continue;
    try {
      const until = Math.floor(Date.now() / 1000) + 60;
      const now = new Date();
      await getTelegramClient().banChatMember({ chatId: Number(chat.telegramChatId), userId: user.id, untilDate: until, revokeMessages: true });
      await prisma.$transaction([
        prisma.chatMember.update({ where: { id: membership.id }, data: { status: "BANNED", punishmentState: "BANNED", punishmentExpiresAt: new Date(until * 1000), lastModerationAt: now } }),
        prisma.auditLog.create({ data: { chatId, affectedUserId: membership.userId, source: "SYSTEM", action: "EXISTING_MEMBER_BLOCKED", reason, metadata: { reason } } }),
        prisma.moderationAction.create({ data: { chatId, affectedUserId: membership.userId, source: "SYSTEM", type: "BAN", status: "SUCCEEDED", reason, expiresAt: new Date(until * 1000), completedAt: now, metadata: { reason, trigger: "EXISTING_MEMBER_REVIEW" } } })
      ]);
      blocked += 1;
    } catch { /* Best effort: one Telegram failure must not stop the review. */ }
  }
  return { checked: memberships.length, blocked };
}
