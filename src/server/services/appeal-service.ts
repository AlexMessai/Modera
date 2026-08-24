import { Prisma } from "@/generated/prisma/client";
import { notifyAdminsOfNewAppeal, notifyAppealDecision } from "@/server/services/appeal-notification-service";
import { resolveEffectiveChatAppealSettings } from "@/server/services/chat-appeal-settings-service";
import { prisma } from "@/server/db/prisma";
import { executeModerationAction, ModerationError } from "@/server/services/moderation-service";
import { revokeWarningRecord } from "@/server/services/warning-service";

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

type AppealCandidate = {
  moderationActionId: string;
  chatId: string;
  chatTitle: string;
  actionType: "WARNING" | "MUTE" | "BAN";
};

/**
 * Every appeal-eligible punishment a Telegram user still has an open shot
 * at -- mirrors self-unmute-service.ts::listActiveMutes (called directly by
 * update-handler.ts for the numbered chat picker when there's more than
 * one). "Eligible" means: WARNING/MUTE/BAN that succeeded, has no Appeal
 * yet, and whose chat hasn't turned /appeal off (ChatAppealSettings.enabled).
 * At most one candidate per chat -- the most recent un-appealed punishment
 * in that chat -- since /appeal only ever targets "the latest one" per the
 * product decision, same as how a mute is inherently one-per-chat for
 * /unmute.
 */
export async function listAppealCandidates(telegramUserId: number): Promise<AppealCandidate[]> {
  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(telegramUserId) },
    select: { id: true }
  });
  if (!user) return [];

  const actions = await prisma.moderationAction.findMany({
    where: {
      affectedUserId: user.id,
      status: "SUCCEEDED",
      appeal: { is: null },
      OR: [
        { type: { in: ["MUTE", "BAN"] } },
        { type: "WARNING", revokedAt: null }
      ]
    },
    orderBy: { createdAt: "desc" },
    include: { chat: { select: { id: true, title: true } } }
  });

  const seenChats = new Set<string>();
  const candidates: AppealCandidate[] = [];
  for (const action of actions) {
    if (seenChats.has(action.chatId)) continue;
    const { settings } = await resolveEffectiveChatAppealSettings(action.chatId);
    if (!settings.enabled) continue;
    seenChats.add(action.chatId);
    candidates.push({
      moderationActionId: action.id,
      chatId: action.chatId,
      chatTitle: action.chat.title,
      actionType: action.type as "WARNING" | "MUTE" | "BAN"
    });
  }
  return candidates;
}

/**
 * Replaces the old submitAppealFromReply, which matched a punishment to
 * appeal exclusively via metadata.appealDmMessageId === replyToMessageId --
 * the id of the DM message that no longer exists (see decision #1). /appeal
 * no longer requires a Reply: this finds the user's latest appeal-eligible
 * punishment automatically, using the same numbered-chat-picker pattern
 * /unmute already uses when there's more than one.
 *
 * `chatId` lets a caller that already resolved the ambiguity (update-handler.ts,
 * after the user replied with an explicit chat number) submit directly; when
 * omitted, 0/1 candidates resolve on their own and 2+ come back as
 * "multiple_chats" without submitting -- same shape /unmute's own
 * `listActiveMutes` + numbered-picker flow already produces.
 */
export async function submitLatestAppeal(input: {
  fromTelegramUserId: number;
  text: string;
  chatId?: string;
}): Promise<
  | { outcome: "action_not_found" }
  | { outcome: "already_submitted" }
  | { outcome: "empty_message" }
  | { outcome: "multiple_chats"; candidates: AppealCandidate[] }
  | { outcome: "submitted" }
> {
  const candidates = await listAppealCandidates(input.fromTelegramUserId);
  if (candidates.length === 0) return { outcome: "action_not_found" as const };

  let chosen: AppealCandidate;
  if (input.chatId) {
    const match = candidates.find((candidate) => candidate.chatId === input.chatId);
    if (!match) return { outcome: "action_not_found" as const };
    chosen = match;
  } else if (candidates.length > 1) {
    return { outcome: "multiple_chats" as const, candidates };
  } else {
    chosen = candidates[0];
  }

  const message = normalize(input.text, MAX_MESSAGE_LENGTH);
  if (!message) return { outcome: "empty_message" as const };

  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(input.fromTelegramUserId) },
    select: { id: true, displayName: true }
  });
  if (!user) return { outcome: "action_not_found" as const };

  let appeal;
  try {
    appeal = await prisma.appeal.create({
      data: {
        chatId: chosen.chatId,
        userId: user.id,
        moderationActionId: chosen.moderationActionId,
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
      chatId: chosen.chatId,
      affectedUserId: user.id,
      source: "TELEGRAM",
      action: "APPEAL_SUBMITTED",
      metadata: { moderationActionId: chosen.moderationActionId }
    }
  });

  await notifyAdminsOfNewAppeal({
    chatId: chosen.chatId,
    appealId: appeal.id,
    chatTitle: chosen.chatTitle,
    userDisplayName: user.displayName,
    actionType: chosen.actionType,
    message
  }).catch(() => undefined);

  return { outcome: "submitted" as const };
}

export async function listAppeals(input: {
  page: number;
  pageSize: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  chatId?: string;
  visibleChatIds?: string[] | null;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));

  const where: Prisma.AppealWhereInput = {
    status: input.status,
    ...(input.chatId
      ? input.visibleChatIds !== null && input.visibleChatIds !== undefined && !input.visibleChatIds.includes(input.chatId)
        ? { chatId: { in: [] } }
        : { chatId: input.chatId }
      : input.visibleChatIds !== null && input.visibleChatIds !== undefined
        ? { chatId: { in: input.visibleChatIds } }
        : {})
  };

  const pendingWhere: Prisma.AppealWhereInput = {
    status: "PENDING",
    ...(input.visibleChatIds !== null && input.visibleChatIds !== undefined
      ? { chatId: { in: input.visibleChatIds } }
      : {})
  };

  const [total, pendingCount, items] = await Promise.all([
    prisma.appeal.count({ where }),
    prisma.appeal.count({ where: pendingWhere }),
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

async function revertWarning(input: {
  chatId: string;
  userId: string;
  moderationActionId: string;
  actingAdminId: string;
  comment: string | null;
}) {
  const result = await revokeWarningRecord({
    chatId: input.chatId,
    affectedUserId: input.userId,
    warningActionId: input.moderationActionId,
    revokedByAdminId: input.actingAdminId,
    revocationReason: input.comment
      ? `Апелляция одобрена: ${input.comment}`
      : "Апелляция одобрена."
  });
  if (result.outcome === "not_found") {
    throw new AppealError(
      "WARNING_NOT_FOUND",
      "Связанное предупреждение не найдено.",
      409
    );
  }
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
      chatId: appeal.chatId,
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
    await revertWarning({
      chatId: appeal.chatId,
      userId: appeal.userId,
      moderationActionId: appeal.moderationActionId,
      actingAdminId: input.actingAdminId,
      comment
    });
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
    chatId: appeal.chatId,
    telegramUserId: appeal.user.telegramUserId,
    chatTitle: appeal.chat.title,
    decision: "APPROVED",
    comment
  }).catch(() => undefined);

  return { id: appeal.id, status: "APPROVED" as const, resolvedAt: now.toISOString() };
}
