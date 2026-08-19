import { prisma } from "@/server/db/prisma";
import { getTelegramClient } from "@/server/telegram/client";

const ACTION_LABELS: Record<string, string> = {
  WARNING: "предупреждение",
  MUTE: "временное ограничение (mute)",
  BAN: "блокировка (ban)"
};

function telegramErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown Telegram error";
}

export async function notifyPunishmentAppealOption(input: {
  moderationActionId: string;
  chatId: string;
  userId: string;
  telegramUserId: bigint;
  chatTitle: string;
  actionType: "WARNING" | "MUTE" | "BAN";
  reason: string | null;
}) {
  const client = getTelegramClient();
  const label = ACTION_LABELS[input.actionType] ?? input.actionType;
  const text = `В чате «${input.chatTitle}» вам выдано: ${label}.${input.reason ? `\nПричина: ${input.reason}` : ""}\n\nЕсли вы не согласны, ответьте на это сообщение (Reply) командой /appeal и опишите причину одним сообщением, например:\n/appeal я не отправлял это сообщение`;

  let dmMessageId: number | null = null;
  try {
    const sent = await client.sendMessage({
      chatId: Number(input.telegramUserId),
      text
    });
    dmMessageId = sent.message_id;
  } catch (error) {
    await prisma.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.userId,
        source: "SYSTEM",
        action: "APPEAL_NOTIFICATION_FAILED",
        metadata: {
          moderationActionId: input.moderationActionId,
          error: telegramErrorMessage(error)
        }
      }
    });
    return { delivered: false as const };
  }

  try {
    const current = await prisma.moderationAction.findUnique({
      where: { id: input.moderationActionId },
      select: { metadata: true }
    });
    const existingMetadata =
      current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
        ? current.metadata
        : {};
    await prisma.moderationAction.update({
      where: { id: input.moderationActionId },
      data: {
        metadata: { ...existingMetadata, appealDmMessageId: dmMessageId }
      }
    });
  } catch (error) {
    await prisma.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.userId,
        source: "SYSTEM",
        action: "APPEAL_NOTIFICATION_FAILED",
        metadata: {
          moderationActionId: input.moderationActionId,
          stage: "PERSIST_DM_MESSAGE_ID",
          error: telegramErrorMessage(error)
        }
      }
    }).catch(() => undefined);
    return { delivered: true as const, dmMessageId: null };
  }

  return { delivered: true as const, dmMessageId };
}

const PENDING_NOTIFICATION_LIMIT = 3;

function hasDeliveredDm(metadata: unknown) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      "appealDmMessageId" in metadata &&
      (metadata as { appealDmMessageId?: unknown }).appealDmMessageId
  );
}

export async function deliverPendingAppealNotifications(telegramUserId: number) {
  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(telegramUserId) },
    select: { id: true }
  });
  if (!user) return;

  const candidates = await prisma.moderationAction.findMany({
    where: {
      affectedUserId: user.id,
      type: { in: ["WARNING", "MUTE", "BAN"] },
      status: "SUCCEEDED",
      appeal: { is: null }
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { chat: { select: { id: true, title: true } } }
  });

  const undelivered = candidates.filter((action) => !hasDeliveredDm(action.metadata)).slice(0, PENDING_NOTIFICATION_LIMIT);

  for (const action of undelivered) {
    await notifyPunishmentAppealOption({
      moderationActionId: action.id,
      chatId: action.chatId,
      userId: user.id,
      telegramUserId: BigInt(telegramUserId),
      chatTitle: action.chat.title,
      actionType: action.type as "WARNING" | "MUTE" | "BAN",
      reason: action.reason
    }).catch(() => undefined);
  }
}

export async function notifyAppealDecision(input: {
  telegramUserId: bigint;
  chatTitle: string;
  decision: "APPROVED" | "REJECTED";
  comment: string | null;
}) {
  const client = getTelegramClient();
  const text = input.decision === "APPROVED"
    ? `Ваша апелляция по чату «${input.chatTitle}» одобрена, наказание отменено.${input.comment ? `\nКомментарий администратора: ${input.comment}` : ""}`
    : `Ваша апелляция по чату «${input.chatTitle}» отклонена.${input.comment ? `\nКомментарий администратора: ${input.comment}` : ""}`;

  try {
    await client.sendMessage({ chatId: Number(input.telegramUserId), text });
    return { delivered: true as const };
  } catch {
    return { delivered: false as const };
  }
}
