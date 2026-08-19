import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { resolveAppeal, submitAppealFromReply } from "./appeal-service";

const CHAT_ID = -1009000014001n;
const TELEGRAM_USER_ID = 900001401n;
const ADMIN_EMAIL = "appeal-service-ci@example.com";
const DM_MESSAGE_ID = 555001;

async function setup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: TELEGRAM_USER_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });

  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Appeal CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: TELEGRAM_USER_ID, firstName: "Appeal", displayName: "Appeal User" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Moderator", passwordHash: "not-used-in-test", role: "MODERATOR" }
  });
  const member = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER", warningCount: 2 }
  });
  const warningAction = await prisma.moderationAction.create({
    data: {
      chatId: chat.id,
      affectedUserId: user.id,
      actingAdminId: admin.id,
      source: "ADMIN",
      type: "WARNING",
      status: "SUCCEEDED",
      reason: "Тестовое предупреждение",
      completedAt: new Date(),
      metadata: { appealDmMessageId: DM_MESSAGE_ID }
    }
  });

  return { chat, user, admin, member, warningAction };
}

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: TELEGRAM_USER_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("submitAppealFromReply rejects unknown users, empty text and non-matching replies", async () => {
  await cleanup();
  const { warningAction } = await setup();

  try {
    const unknownUser = await submitAppealFromReply({
      fromTelegramUserId: 999999999,
      replyToMessageId: DM_MESSAGE_ID,
      text: "причина"
    });
    assert.equal(unknownUser.outcome, "action_not_found");

    const empty = await submitAppealFromReply({
      fromTelegramUserId: Number(TELEGRAM_USER_ID),
      replyToMessageId: DM_MESSAGE_ID,
      text: "   "
    });
    assert.equal(empty.outcome, "empty_message");

    const wrongReply = await submitAppealFromReply({
      fromTelegramUserId: Number(TELEGRAM_USER_ID),
      replyToMessageId: DM_MESSAGE_ID + 1,
      text: "причина"
    });
    assert.equal(wrongReply.outcome, "action_not_found");

    const submitted = await submitAppealFromReply({
      fromTelegramUserId: Number(TELEGRAM_USER_ID),
      replyToMessageId: DM_MESSAGE_ID,
      text: "Я не отправлял это сообщение"
    });
    assert.equal(submitted.outcome, "submitted");

    const stored = await prisma.appeal.findUnique({ where: { moderationActionId: warningAction.id } });
    assert.equal(stored?.status, "PENDING");
    assert.equal(stored?.message, "Я не отправлял это сообщение");

    const duplicate = await submitAppealFromReply({
      fromTelegramUserId: Number(TELEGRAM_USER_ID),
      replyToMessageId: DM_MESSAGE_ID,
      text: "ещё раз"
    });
    assert.equal(duplicate.outcome, "already_submitted");
  } finally {
    await cleanup();
  }
});

test("approving a WARNING appeal decrements warningCount without calling Telegram", async () => {
  await cleanup();
  const { admin, member, warningAction } = await setup();

  try {
    const appeal = await prisma.appeal.create({
      data: {
        chatId: warningAction.chatId,
        userId: warningAction.affectedUserId,
        moderationActionId: warningAction.id,
        message: "Причина апелляции"
      }
    });

    const result = await resolveAppeal({
      appealId: appeal.id,
      actingAdminId: admin.id,
      decision: "APPROVE",
      comment: "Разобрались, предупреждение снято"
    });
    assert.equal(result.status, "APPROVED");

    const updatedMember = await prisma.chatMember.findUnique({ where: { id: member.id } });
    assert.equal(updatedMember?.warningCount, 1);

    const updatedAppeal = await prisma.appeal.findUnique({ where: { id: appeal.id } });
    assert.equal(updatedAppeal?.status, "APPROVED");
    assert.equal(updatedAppeal?.resolutionComment, "Разобрались, предупреждение снято");

    const again = await resolveAppeal({ appealId: appeal.id, actingAdminId: admin.id, decision: "REJECT" });
    assert.equal(again.status, "APPROVED", "resolving an already-resolved appeal is a no-op");
  } finally {
    await cleanup();
  }
});

test("rejecting an appeal updates its status even when the Telegram DM cannot be sent", async () => {
  await cleanup();
  const { admin, warningAction } = await setup();

  try {
    const appeal = await prisma.appeal.create({
      data: {
        chatId: warningAction.chatId,
        userId: warningAction.affectedUserId,
        moderationActionId: warningAction.id,
        message: "Причина апелляции"
      }
    });

    const result = await resolveAppeal({
      appealId: appeal.id,
      actingAdminId: admin.id,
      decision: "REJECT",
      comment: "Нарушение подтверждено"
    });
    assert.equal(result.status, "REJECTED");

    const updatedAppeal = await prisma.appeal.findUnique({ where: { id: appeal.id } });
    assert.equal(updatedAppeal?.status, "REJECTED");
    assert.equal(updatedAppeal?.resolutionComment, "Нарушение подтверждено");
  } finally {
    await cleanup();
  }
});
