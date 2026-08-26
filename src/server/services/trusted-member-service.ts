import { prisma } from "@/server/db/prisma";

export const TRUSTED_INTERNAL_ROLE = "TRUSTED";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function isTrustedTelegramMember(chatId: string, telegramUserId: number) {
  const member = await prisma.chatMember.findFirst({
    where: {
      chatId,
      internalRole: TRUSTED_INTERNAL_ROLE,
      user: { telegramUserId: BigInt(telegramUserId) }
    },
    select: { id: true }
  });
  return Boolean(member);
}

export async function setTrustedMember(input: {
  membershipId: string;
  actingAdminId: string;
  trusted: boolean;
}) {
  if (!UUID_PATTERN.test(input.membershipId)) return null;

  const membership = await prisma.chatMember.findUnique({
    where: { id: input.membershipId },
    include: {
      user: { select: { id: true, displayName: true, telegramUserId: true, isBot: true } },
      chat: { select: { id: true, title: true } }
    }
  });
  if (!membership) return null;
  if (membership.user.isBot) {
    return { error: "BOT_NOT_SUPPORTED" as const };
  }

  const currentlyTrusted = membership.internalRole === TRUSTED_INTERNAL_ROLE;
  if (currentlyTrusted === input.trusted) {
    return {
      changed: false,
      trusted: currentlyTrusted,
      membershipId: membership.id,
      userDisplayName: membership.user.displayName,
      chatTitle: membership.chat.title
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.chatMember.update({
      where: { id: membership.id },
      data: {
        internalRole: input.trusted
          ? TRUSTED_INTERNAL_ROLE
          : membership.internalRole === TRUSTED_INTERNAL_ROLE
            ? null
            : membership.internalRole
      }
    });

    await tx.auditLog.create({
      data: {
        chatId: membership.chatId,
        affectedUserId: membership.userId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: input.trusted ? "TRUSTED_MEMBER_ADDED" : "TRUSTED_MEMBER_REMOVED",
        reason: input.trusted
          ? "Пользователь добавлен в исключения автоматической модерации."
          : "Пользователь удалён из исключений автоматической модерации.",
        metadata: {
          membershipId: membership.id,
          telegramUserId: membership.user.telegramUserId.toString(),
          internalRole: updated.internalRole
        }
      }
    });

    return updated;
  });

  return {
    changed: true,
    trusted: result.internalRole === TRUSTED_INTERNAL_ROLE,
    membershipId: membership.id,
    userDisplayName: membership.user.displayName,
    chatTitle: membership.chat.title
  };
}