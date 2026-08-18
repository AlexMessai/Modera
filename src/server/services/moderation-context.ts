import { prisma } from "@/server/db/prisma";

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
      warningCount: true,
      user: {
        select: {
          displayName: true,
          isBot: true
        }
      },
      chat: {
        select: {
          type: true,
          botLinks: {
            orderBy: { lastSeenAt: "desc" },
            take: 1,
            select: {
              status: true,
              permissions: true,
              lastSeenAt: true
            }
          }
        }
      }
    }
  });

  if (!membership) return null;

  const actions = await prisma.moderationAction.findMany({
    where: {
      chatId: membership.chatId,
      affectedUserId: membership.userId
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      actingAdmin: {
        select: {
          displayName: true,
          role: true
        }
      }
    }
  });

  const botLink = membership.chat.botLinks[0];
  const permissions = botLink?.permissions as
    | { canRestrictMembers?: boolean }
    | null
    | undefined;

  return {
    membershipId: membership.id,
    status: membership.status,
    punishmentState: membership.punishmentState,
    warningCount: membership.warningCount,
    userDisplayName: membership.user.displayName,
    userIsBot: membership.user.isBot,
    chatType: membership.chat.type,
    botStatus: botLink?.status ?? "DISABLED",
    storedBotCanRestrict: Boolean(permissions?.canRestrictMembers),
    botRightsCheckedAt: botLink?.lastSeenAt ?? null,
    actions: actions.map((action) => ({
      id: action.id,
      type: action.type,
      status: action.status,
      reason: action.reason,
      telegramError: action.telegramError,
      createdAt: action.createdAt,
      completedAt: action.completedAt,
      actingAdmin: action.actingAdmin
    }))
  };
}
