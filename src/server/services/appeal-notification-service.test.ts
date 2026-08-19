import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { deliverPendingAppealNotifications } from "./appeal-notification-service";

const CHAT_ID = -1009000015001n;
const TELEGRAM_USER_ID = 900001501n;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: TELEGRAM_USER_ID } });
}

test("pending notification delivery skips already-notified and already-appealed actions, retries the rest", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Pending Appeal Notify CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: TELEGRAM_USER_ID, firstName: "Pending", displayName: "Pending User" }
  });

  const undeliveredAction = await prisma.moderationAction.create({
    data: {
      chatId: chat.id,
      affectedUserId: user.id,
      source: "ADMIN",
      type: "WARNING",
      status: "SUCCEEDED",
      reason: "Не доставлено",
      completedAt: new Date()
    }
  });
  const alreadyDeliveredAction = await prisma.moderationAction.create({
    data: {
      chatId: chat.id,
      affectedUserId: user.id,
      source: "ADMIN",
      type: "WARNING",
      status: "SUCCEEDED",
      reason: "Уже доставлено",
      completedAt: new Date(),
      metadata: { appealDmMessageId: 12345 }
    }
  });
  const alreadyAppealedAction = await prisma.moderationAction.create({
    data: {
      chatId: chat.id,
      affectedUserId: user.id,
      source: "ADMIN",
      type: "WARNING",
      status: "SUCCEEDED",
      reason: "Уже подана апелляция",
      completedAt: new Date()
    }
  });
  await prisma.appeal.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      moderationActionId: alreadyAppealedAction.id,
      message: "Апелляция уже подана"
    }
  });

  try {
    await deliverPendingAppealNotifications(Number(TELEGRAM_USER_ID));

    const failedNotifications = await prisma.auditLog.findMany({
      where: { chatId: chat.id, action: "APPEAL_NOTIFICATION_FAILED" }
    });
    const notifiedActionIds = failedNotifications.map((log) => (log.metadata as { moderationActionId?: string })?.moderationActionId);

    assert.ok(notifiedActionIds.includes(undeliveredAction.id), "retries the action with no dmMessageId yet");
    assert.ok(!notifiedActionIds.includes(alreadyDeliveredAction.id), "skips an action that already has a delivered DM");
    assert.ok(!notifiedActionIds.includes(alreadyAppealedAction.id), "skips an action that already has an appeal");
  } finally {
    await cleanup();
  }
});
