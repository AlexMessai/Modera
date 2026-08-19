import { Prisma } from "@/generated/prisma/client";
import { notifyAppealDecision } from "@/server/services/appeal-notification-service";
import { prisma } from "@/server/db/prisma";
import { executeModerationAction, ModerationError } from "@/server/services/moderation-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 1000;

export class AppealError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "AppealError";
  }
}

function normalize(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

export async function submitAppealFromReply(input: {
  fromTelegramUserId: number;
  replyToMessageId: number;
  text: string;
}) {
  const message = normalize(input.text, MAX_MESSAGE_LENGTH);
  if (!message) return { outcome: "empty_message" as const };

  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(input.fromTelegramUserId) },
    select: { id: true }
  });
  if (!user) return { outcome: "action_not_found" as const };

  const action = await prisma.moderationAction.findFirst({
    where: {
      affectedUserId: user.id,
      type: { in: ["WARNING", "MUTE", "BAN"] },
      metadata: { path: ["appealDmMessageId"], equals: input.replyToMessageId }
    },
    orderBy: { createdAt: "desc" }
  });
  if (!action) return { outcome: "action_not_found" as const };

  const existing = await prisma.appeal.findUnique({ where: { moderationActionId: action.id } });
  if (existing) return { outcome: "already_submitted" as const };

  try {
    await prisma.appeal.create({
      data: {
        chatId: action.chatId,
        userId: user.id,
        moderationActionId: action.id,
        message
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { outcome: "already_submitted" as const };
    }
    throw error;
  }

  await prisma.auditLog.create({
    data: {
      chatId: action.chatId,
      affectedUserId: user.id,
      source: "TELEGRAM",
      action: "APPEAL_SUBMITTED",
      metadata: { moderationActionId: action.id }
    }
  });

  return { outcome: "submitted" as const };
}

export async function listAppeals(input: {
  page: number;
  pageSize: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  chatId?: string;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));

  const where: Prisma.AppealWhereInput = {
    status: input.status,
    ...(input.chatId ? { chatId: input.chatId } : {})
  };

  const [total, pendingCount, items] = await Promise.all([
    prisma.appeal.count({ where }),
    prisma.appeal.count({ where: { status: "PENDING" } }),
    prisma.appeal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        chat: { select: { id: true, title: true, telegramChatId: true } },
        user: { select: { id: true, displayName: true, username: true, telegramUserId: true } },
        resolvedByAdmin: { select: { displayName: true } },
        moderationAction: { select: { id: true, type: true, reason: true, createdAt: true } }
      }
    })
  ]);

  return {
    pendingCount,
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      message: item.message,
      resolutionComment: item.resolutionComment,
      createdAt: item.createdAt.toISOString(),
      resolvedAt: item.resolvedAt?.toISOString() ?? null,
      resolvedBy: item.resolvedByAdmin?.displayName ?? null,
      chat: {
        id: item.chat.id,
        title: item.chat.title,
        telegramChatId: item.chat.telegramChatId.toString()
      },
      user: {
        id: item.user.id,
        displayName: item.user.displayName,
        username: item.user.username,
        telegramUserId: item.user.telegramUserId.toString()
      },
      moderationAction: {
        id: item.moderationAction.id,
        type: item.moderationAction.type,
        reason: item.moderationAction.reason,
        createdAt: item.moderationAction.createdAt.toISOString()
      }
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

async function revertWarning(input: { chatId: string; userId: string; moderationActionId: string }) {
  const membership = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId: input.chatId, userId: input.userId } },
    select: { id: true, warningCount: true }
  });
  if (!membership) return;
  await prisma.chatMember.update({
    where: { id: membership.id },
    data: { warningCount: Math.max(0, membership.warningCount - 1) }
  });
}

export async function resolveAppeal(input: {
  appealId: string;
  actingAdminId: string;
  decision: "APPROVE" | "REJECT";
  comment?: string | null;
}) {
  if (!UUID_PATTERN.test(input.appealId)) {
    throw new AppealError("APPEAL_NOT_FOUND", "Апелляция не найдена.", 404);
  }

  const appeal = await prisma.appeal.findUnique({
    where: { id: input.appealId },
    include: {
      chat: true,
      user: true,
      moderationAction: true
    }
  });
  if (!appeal) throw new AppealError("APPEAL_NOT_FOUND", "Апелляция не найдена.", 404);
  if (appeal.status !== "PENDING") {
    return {
      id: appeal.id,
      status: appeal.status,
      resolvedAt: appeal.resolvedAt?.toISOString() ?? null
    };
  }

  const comment = input.comment ? normalize(input.comment, MAX_COMMENT_LENGTH) || null : null;
  const now = new Date();

  if (input.decision === "REJECT") {
    await prisma.$transaction([
      prisma.appeal.update({
        where: { id: appeal.id },
        data: { status: "REJECTED", resolvedByAdminId: input.actingAdminId, resolutionComment: comment, resolvedAt: now }
      }),
      prisma.auditLog.create({
        data: {
          chatId: appeal.chatId,
          affectedUserId: appeal.userId,
          actingAdminId: input.actingAdminId,
          source: "ADMIN",
          action: "APPEAL_REJECTED",
          reason: comment,
          metadata: { appealId: appeal.id, moderationActionId: appeal.moderationActionId }
        }
      })
    ]);
    await notifyAppealDecision({
      telegramUserId: appeal.user.telegramUserId,
      chatTitle: appeal.chat.title,
      decision: "REJECTED",
      comment
    }).catch(() => undefined);
    return { id: appeal.id, status: "REJECTED" as const, resolvedAt: now.toISOString() };
  }

  const membership = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId: appeal.chatId, userId: appeal.userId } }
  });
  if (!membership) throw new AppealError("MEMBER_NOT_FOUND", "Участник не найден.", 404);

  if (appeal.moderationAction.type === "WARNING") {
    await revertWarning({ chatId: appeal.chatId, userId: appeal.userId, moderationActionId: appeal.moderationActionId });
  } else {
    const unwindAction = appeal.moderationAction.type === "MUTE" ? "UNMUTE" : "UNBAN";
    try {
      await executeModerationAction({
        membershipId: membership.id,
        actingAdminId: input.actingAdminId,
        action: unwindAction,
        reason: `Апелляция одобрена${comment ? `: ${comment}` : ""}`
      });
    } catch (error) {
      const alreadyResolved =
        error instanceof ModerationError &&
        (error.code === "NOT_MUTED" || error.code === "NOT_BANNED" || error.code === "TARGET_PROTECTED");
      if (!alreadyResolved) {
        const message = error instanceof ModerationError ? error.message : "Не удалось отменить наказание в Telegram.";
        throw new AppealError("APPEAL_REVERT_FAILED", message, 502);
      }
    }
  }

  await prisma.$transaction([
    prisma.appeal.update({
      where: { id: appeal.id },
      data: { status: "APPROVED", resolvedByAdminId: input.actingAdminId, resolutionComment: comment, resolvedAt: now }
    }),
    prisma.auditLog.create({
      data: {
        chatId: appeal.chatId,
        affectedUserId: appeal.userId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "APPEAL_APPROVED",
        reason: comment,
        metadata: { appealId: appeal.id, moderationActionId: appeal.moderationActionId, revertedType: appeal.moderationAction.type }
      }
    })
  ]);

  await notifyAppealDecision({
    telegramUserId: appeal.user.telegramUserId,
    chatTitle: appeal.chat.title,
    decision: "APPROVED",
    comment
  }).catch(() => undefined);

  return { id: appeal.id, status: "APPROVED" as const, resolvedAt: now.toISOString() };
}
