import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { getSelfServiceStatusMessage, listActiveMutes, MAX_SELF_UNMUTES, selfUnmute } from "./self-unmute-service";

const CHAT_ID = -1009000016001n;
const TELEGRAM_USER_ID = 900001601n;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: TELEGRAM_USER_ID } });
}

test("selfUnmute rejects an unknown user and a user with no active mute in the chat", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Self Unmute CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: TELEGRAM_USER_ID, firstName: "Unmute", displayName: "Unmute User" }
  });
  await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER" }
  });

  try {
    const unknown = await selfUnmute({ telegramUserId: 999999998, chatId: chat.id });
    assert.equal(unknown.outcome, "not_found");

    const notMuted = await selfUnmute({ telegramUserId: Number(TELEGRAM_USER_ID), chatId: chat.id });
    assert.equal(notMuted.outcome, "not_muted");
  } finally {
    await cleanup();
  }
});

test("selfUnmute refuses once the per-chat quota is exhausted, without calling Telegram", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Self Unmute Quota CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: TELEGRAM_USER_ID, firstName: "Unmute", displayName: "Unmute User" }
  });
  const member = await prisma.chatMember.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      status: "RESTRICTED",
      punishmentState: "MUTED",
      punishmentExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      selfUnmuteCount: MAX_SELF_UNMUTES
    }
  });

  try {
    const active = await listActiveMutes(Number(TELEGRAM_USER_ID));
    assert.equal(active.length, 1);
    assert.equal(active[0].id, member.id);

    const result = await selfUnmute({ telegramUserId: Number(TELEGRAM_USER_ID), chatId: chat.id });
    assert.equal(result.outcome, "quota_exhausted");
    assert.match(result.message, /апелляц/i);

    const unchanged = await prisma.chatMember.findUnique({ where: { id: member.id } });
    assert.equal(unchanged?.punishmentState, "MUTED", "quota-exhausted attempt must not touch punishment state");
  } finally {
    await cleanup();
  }
});

test("selfUnmute degrades to telegram_error (not a throw) when Telegram is unavailable, leaving quota untouched", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Self Unmute Attempt CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: TELEGRAM_USER_ID, firstName: "Unmute", displayName: "Unmute User" }
  });
  const member = await prisma.chatMember.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      status: "RESTRICTED",
      punishmentState: "MUTED",
      punishmentExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });

  try {
    const result = await selfUnmute({ telegramUserId: Number(TELEGRAM_USER_ID), chatId: chat.id });
    assert.equal(result.outcome, "telegram_error");

    const unchanged = await prisma.chatMember.findUnique({ where: { id: member.id } });
    assert.equal(unchanged?.selfUnmuteCount, 0, "a failed Telegram call must not consume a self-unmute attempt");
  } finally {
    await cleanup();
  }
});

test("status message reports remaining unlocks against the most recent mute even once it's cleared", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Self Unmute Status CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: TELEGRAM_USER_ID, username: "statususer", firstName: "Unmute", displayName: "Unmute User" }
  });
  const member = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER", selfUnmuteCount: 1 }
  });
  await prisma.moderationAction.create({
    data: {
      chatId: chat.id,
      affectedUserId: user.id,
      source: "ADMIN",
      type: "MUTE",
      status: "SUCCEEDED",
      reason: "offtop",
      completedAt: new Date()
    }
  });

  try {
    const message = await getSelfServiceStatusMessage(Number(TELEGRAM_USER_ID));
    assert.match(message, /@statususer/);
    assert.match(message, /без ограничений/);
    assert.match(message, new RegExp(`Осталось разблоков: ${MAX_SELF_UNMUTES - 1}`));
    assert.match(message, /offtop/);
  } finally {
    await prisma.chatMember.delete({ where: { id: member.id } }).catch(() => undefined);
    await cleanup();
  }
});
