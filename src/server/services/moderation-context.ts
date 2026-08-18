import { prisma } from "@/server/db/prisma";
import { resolveEffectiveModerationSettings } from "@/server/services/global-moderation-service";
import { countActiveWarnings } from "@/server/services/moderation-escalation-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getModerationContext(membershipId: string) {
  if (!UUID_PATTERN.test(membershipId)) return null;

  const membership = await prisma.chatMember.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      chatId: true,
      userId: true,
      status: true,
      punishmentState: true,
      punishmentExpiresAt: true,
      warningCount: true,
      user: { select: { displayName: true, isBot: true } },
      chat: {
        select: {
          type: true,
          botLinks: {
            orderBy: { lastSeenAt: "desc" },
            take: 1,
            select: { status: true, permissions: true, lastSeenAt: true }
          }
        }
      }
    }
  });

  if (!membership) return null;

  const [actions, policy] = await Promise.all([
    prisma.moderationAction.findMany({
      where: { chatId: membership.chatId, affectedUserId: membership.userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        actingAdmin: { select: { displayName: true, role: true } }
      }
    }),
    resolveEffectiveModerationSettings(membership.chatId)
  ]);

  const activeWarningCount = await countActiveWarnings({
    chatId: membership.chatId,
    affectedUserId: membership.userId,
    warningExpiryDays: policy.settings.warningExpiryDays
  });

  const botLink = membership.chat.botLinks[0];
  const permissions = botLink?.permissions as { canRestrictMembers?: boolean } | null | undefined;

  return {
    membershipId: membership.id,
    status: membership.status,
    punishmentState: membership.punishmentState,
    punishmentExpiresAt: membership.punishmentExpiresAt,
    warningCount: membership.warningCount,
    activeWarningCount,
    warningExpiryDays: policy.settings.warningExpiryDays,
    userDisplayName: membership.user.displayName,
    userIsBot: membership.user.isBot,
    chatType: membership.chat.type,
    botStatus: botLink?.status ?? "DISABLED",
    storedBotCanRestrict: Boolean(permissions?.canRestrictMembers),
    botRightsCheckedAt: botLink?.lastSeenAt ?? null,
    actions: actions.map((action) => ({
      id: action.id,
      source: action.source,
      type: action.type,
      status: action.status,
      reason: action.reason,
      expiresAt: action.expiresAt,
      telegramError: action.telegramError,
      createdAt: action.createdAt,
      completedAt: action.completedAt,
      actingAdmin: action.actingAdmin
    }))
  };
}