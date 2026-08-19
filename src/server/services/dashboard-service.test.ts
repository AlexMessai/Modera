import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { getDashboardData } from "./dashboard-service";

const CHAT_ID = -1009000013001n;
const USER_ID = 9000013001n;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: USER_ID } });
}

test("dashboard aggregates persisted Telegram and moderation activity", async () => {
  await cleanup();
  const now = new Date();
  const recent = new Date(now.getTime() - 15 * 60 * 1000);
  const chat = await prisma.chat.create({
    data: {
      telegramChatId: CHAT_ID,
      title: "Dashboard CI",
      type: "supergroup",
      lastActivityAt: recent
    }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId: USER_ID,
      firstName: "Dashboard",
      displayName: "Dashboard User",
      firstSeenAt: recent,
      lastSeenAt: recent
    }
  });
  await prisma.chatMember.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      status: "MEMBER",
      joinedAt: recent,
      firstSeenAt: recent,
      lastSeenAt: recent
    }
  });

  try {
    await prisma.message.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        chatId: chat.id,
        senderUserId: user.id,
        telegramMessageId: 8800000n + BigInt(index),
        telegramDate: new Date(recent.getTime() + index * 1000),
        text: `Dashboard message ${index}`,
        messageType: "TEXT"
      }))
    });

    await prisma.joinRequest.create({
      data: {
        chatId: chat.id,
        userId: user.id,
        telegramUpdateId: 8813001n,
        status: "PENDING",
        requestedAt: recent
      }
    });

    await prisma.moderationAction.create({
      data: {
        chatId: chat.id,
        affectedUserId: user.id,
        source: "SYSTEM",
        type: "WARNING",
        status: "SUCCEEDED",
        reason: "Dashboard CI warning",
        completedAt: recent,
        createdAt: recent
      }
    });

    await prisma.auditLog.create({
      data: {
        chatId: chat.id,
        affectedUserId: user.id,
        source: "SYSTEM",
        action: "AUTOMOD_LINK_DELETED",
        reason: "Dashboard CI automod",
        createdAt: recent
      }
    });

    const dashboard = await getDashboardData("24H");

    assert.equal(dashboard.period, "24H");
    assert.ok(dashboard.metrics.messages.current >= 12);
    assert.ok(dashboard.metrics.newMembers.current >= 1);
    assert.ok(dashboard.metrics.joinRequests.current >= 1);
    assert.ok(dashboard.metrics.moderationActions.current >= 1);
    assert.ok(dashboard.metrics.automodActions.current >= 1);
    assert.ok(dashboard.attention.pendingJoinRequests >= 1);
    assert.ok(dashboard.trend.reduce((sum, item) => sum + item.messages, 0) >= 12);
    assert.ok(dashboard.topChats.some((item) => item.id === chat.id && item.messages >= 12));
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});
