import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { getChatStatistics } from "./chat-statistics-service";

const CHAT_ID = -1009000014001n;
const USER_ID = 9000014001n;
const OTHER_USER_ID = 9000014002n;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: { in: [USER_ID, OTHER_USER_ID] } } });
}

test("chat statistics aggregate messages, joins, moderation, top members and automod rules for one chat", async () => {
  await cleanup();
  const now = new Date();
  const recent = new Date(now.getTime() - 15 * 60 * 1000);

  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Chat Statistics CI", type: "supergroup", lastActivityAt: recent }
  });
  const otherChat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID - 1n, title: "Other Chat", type: "supergroup", lastActivityAt: recent }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: USER_ID, firstName: "Top", displayName: "Top Poster", firstSeenAt: recent, lastSeenAt: recent }
  });
  const otherUser = await prisma.telegramUser.create({
    data: { telegramUserId: OTHER_USER_ID, firstName: "Quiet", displayName: "Quiet Member", firstSeenAt: recent, lastSeenAt: recent }
  });
  const membership = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER", joinedAt: recent, firstSeenAt: recent, lastSeenAt: recent }
  });
  await prisma.chatMember.create({
    data: { chatId: chat.id, userId: otherUser.id, status: "MEMBER", joinedAt: recent, firstSeenAt: recent, lastSeenAt: recent }
  });

  try {
    await prisma.message.createMany({
      data: [
        ...Array.from({ length: 5 }, (_, index) => ({
          chatId: chat.id,
          senderUserId: user.id,
          telegramMessageId: 8900000n + BigInt(index),
          telegramDate: new Date(recent.getTime() + index * 1000),
          text: `Top poster message ${index}`,
          messageType: "TEXT"
        })),
        {
          chatId: chat.id,
          senderUserId: otherUser.id,
          telegramMessageId: 8900100n,
          telegramDate: recent,
          text: "Quiet member message",
          messageType: "TEXT"
        },
        // A message in a different chat must not leak into this chat's stats.
        {
          chatId: otherChat.id,
          senderUserId: user.id,
          telegramMessageId: 8900200n,
          telegramDate: recent,
          text: "Other chat message",
          messageType: "TEXT"
        }
      ]
    });

    await prisma.moderationAction.create({
      data: {
        chatId: chat.id,
        affectedUserId: user.id,
        source: "SYSTEM",
        type: "WARNING",
        status: "SUCCEEDED",
        reason: "Chat statistics CI warning",
        completedAt: recent,
        createdAt: recent
      }
    });

    await prisma.auditLog.createMany({
      data: [
        { chatId: chat.id, affectedUserId: user.id, source: "SYSTEM", action: "AUTOMOD_LINK_DELETED", reason: "CI", createdAt: recent },
        { chatId: chat.id, affectedUserId: user.id, source: "SYSTEM", action: "AUTOMOD_LINK_DELETED", reason: "CI", createdAt: recent },
        { chatId: chat.id, affectedUserId: otherUser.id, source: "SYSTEM", action: "AUTOMOD_SPAM_DELETED", reason: "CI", createdAt: recent },
        // A different chat's automod hit must not leak into this chat's breakdown.
        { chatId: otherChat.id, affectedUserId: user.id, source: "SYSTEM", action: "AUTOMOD_TERM_DELETED", reason: "CI", createdAt: recent }
      ]
    });

    const stats = await getChatStatistics(chat.id, "24H");
    assert.ok(stats);
    assert.equal(stats.period, "24H");
    assert.ok(stats.trend.reduce((sum, item) => sum + item.messages, 0) >= 6);
    assert.ok(stats.trend.reduce((sum, item) => sum + item.newMembers, 0) >= 2);
    assert.ok(stats.trend.reduce((sum, item) => sum + item.moderationActions, 0) >= 1);

    assert.equal(stats.topMembers[0]?.membershipId, membership.id);
    assert.equal(stats.topMembers[0]?.messages, 5);
    assert.ok(!stats.topMembers.some((row) => row.displayName === "Other chat message"));

    const linkRule = stats.ruleBreakdown.find((row) => row.rule === "Ссылки");
    const spamRule = stats.ruleBreakdown.find((row) => row.rule === "Флуд");
    assert.equal(linkRule?.count, 2);
    assert.equal(spamRule?.count, 1);
    assert.equal(stats.ruleBreakdown.some((row) => row.rule === "Запрещённые слова"), false);

    assert.equal(await getChatStatistics("00000000-0000-1000-8000-000000000000", "24H"), null);
    assert.equal(await getChatStatistics("not-a-uuid", "24H"), null);
  } finally {
    await prisma.moderationAction.deleteMany({ where: { chatId: { in: [chat.id, otherChat.id] } } });
    await prisma.auditLog.deleteMany({ where: { chatId: { in: [chat.id, otherChat.id] } } });
    await prisma.message.deleteMany({ where: { chatId: { in: [chat.id, otherChat.id] } } });
    await prisma.chat.deleteMany({ where: { id: { in: [chat.id, otherChat.id] } } });
    await cleanup();
  }
});
