import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { AppealError, listAppealCandidates, resolveAppeal, submitLatestAppeal } from "./appeal-service";
import { updateChatAppealProfile } from "./chat-appeal-settings-service";

const CHAT_ID = -1009000014001n;
const CHAT_ID_2 = -1009000014002n;
const TELEGRAM_USER_ID = 900001401n;
const ADMIN_EMAIL = "appeal-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: { in: [CHAT_ID, CHAT_ID_2] } } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: TELEGRAM_USER_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

async function setup() {
  await cleanup();

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
    data: { chatId: chat.id, userId: user.id, status: "MEMBER", warningCount: 1 }
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
      completedAt: new Date()
    }
  });

  return { chat, user, admin, member, warningAction };
}

test("submitLatestAppeal: no eligible punishment reports action_not_found honestly", async () => {
  await cleanup();
  try {
    const unknownUser = await submitLatestAppeal({ fromTelegramUserId: 999999999, text: "причина" });
    assert.equal(unknownUser.outcome, "action_not_found");
  } finally {
    await cleanup();
  }
});

test("submitLatestAppeal: single eligible chat submits directly without needing a chat number", async () => {
  await cleanup();
  const { warningAction } = await setup();

  try {
    const candidates = await listAppealCandidates(Number(TELEGRAM_USER_ID));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].chatId, warningAction.chatId);

    const empty = await submitLatestAppeal({ fromTelegramUserId: Number(TELEGRAM_USER_ID), text: "   " });
    assert.equal(empty.outcome, "empty_message");

    const submitted = await submitLatestAppeal({
      fromTelegramUserId: Number(TELEGRAM_USER_ID),
      text: "Я не отправлял это сообщение"
    });
    assert.equal(submitted.outcome, "submitted");

    const stored = await prisma.appeal.findUnique({ where: { moderationActionId: warningAction.id } });
    assert.equal(stored?.status, "PENDING");
    assert.equal(stored?.message, "Я не отправлял это сообщение");

    // Once appealed, the action drops out of the candidate list entirely --
    // no more "already appealed" DM to reply to, so a second /appeal now
    // honestly reports nothing left to appeal.
    const again = await submitLatestAppeal({ fromTelegramUserId: Number(TELEGRAM_USER_ID), text: "ещё раз" });
    assert.equal(again.outcome, "action_not_found");
  } finally {
    await cleanup();
  }
});

test("submitLatestAppeal: punishments in two chats come back as multiple_chats until a chatId is given", async () => {
  await cleanup();
  const { chat, user, admin, warningAction } = await setup();
  const chat2 = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID_2, title: "Appeal CI 2", type: "supergroup" }
  });
  const action2 = await prisma.moderationAction.create({
    data: {
      chatId: chat2.id,
      affectedUserId: user.id,
      actingAdminId: admin.id,
      source: "ADMIN",
      type: "MUTE",
      status: "SUCCEEDED",
      reason: "Тестовый mute",
      completedAt: new Date()
    }
  });

  try {
    const candidates = await listAppealCandidates(Number(TELEGRAM_USER_ID));
    assert.equal(candidates.length, 2);

    const ambiguous = await submitLatestAppeal({ fromTelegramUserId: Number(TELEGRAM_USER_ID), text: "причина" });
    assert.equal(ambiguous.outcome, "multiple_chats");
    if (ambiguous.outcome === "multiple_chats") {
      assert.equal(ambiguous.candidates.length, 2);
    }

    const resolved = await submitLatestAppeal({
      fromTelegramUserId: Number(TELEGRAM_USER_ID),
      text: "причина для второго чата",
      chatId: chat2.id
    });
    assert.equal(resolved.outcome, "submitted");

    const stored = await prisma.appeal.findUnique({ where: { moderationActionId: action2.id } });
    assert.equal(stored?.message, "причина для второго чата");

    // The first chat's warning is still un-appealed and still eligible.
    const remaining = await listAppealCandidates(Number(TELEGRAM_USER_ID));
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].chatId, chat.id);
    assert.equal(remaining[0].moderationActionId, warningAction.id);
  } finally {
    await cleanup();
  }
});

test("submitLatestAppeal excludes chats where appeals are disabled", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    await updateChatAppealProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { enabled: false, notifyAdminsOnSubmit: true, notifyUserOnDecision: true }
    });

    const candidates = await listAppealCandidates(Number(TELEGRAM_USER_ID));
    assert.equal(candidates.length, 0);

    const result = await submitLatestAppeal({ fromTelegramUserId: Number(TELEGRAM_USER_ID), text: "причина" });
    assert.equal(result.outcome, "action_not_found");
  } finally {
    await cleanup();
  }
});

test("approving a WARNING appeal decrements warningCount without calling Telegram", async () => {
  await cleanup();
  const { admin, member, warningAction } = await setup();

  try {
    await prisma.$transaction([
      prisma.moderationAction.create({
        data: {
          chatId: warningAction.chatId,
          affectedUserId: warningAction.affectedUserId,
          actingAdminId: admin.id,
          source: "ADMIN",
          type: "WARNING",
          status: "SUCCEEDED",
          reason: "Предыдущее предупреждение",
          completedAt: new Date(Date.now() - 60_000),
          createdAt: new Date(Date.now() - 60_000)
        }
      }),
      prisma.chatMember.update({
        where: { id: member.id },
        data: { warningCount: 2 }
      })
    ]);

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

    const revokedWarning = await prisma.moderationAction.findUniqueOrThrow({
      where: { id: warningAction.id }
    });
    assert.ok(revokedWarning.revokedAt);
    assert.equal(revokedWarning.revokedByAdminId, admin.id);
    assert.equal(revokedWarning.revocationReason, "Апелляция одобрена: Разобрались, предупреждение снято");

    const updatedAppeal = await prisma.appeal.findUnique({ where: { id: appeal.id } });
    assert.equal(updatedAppeal?.status, "APPROVED");
    assert.equal(updatedAppeal?.resolutionComment, "Разобрались, предупреждение снято");

    const again = await resolveAppeal({ appealId: appeal.id, actingAdminId: admin.id, decision: "REJECT" });
    assert.equal(again.status, "APPROVED", "resolving an already-resolved appeal is a no-op");

    const candidates = await listAppealCandidates(Number(TELEGRAM_USER_ID));
    assert.equal(candidates.length, 1, "only the older, still-active warning remains appealable");
  } finally {
    await cleanup();
  }
});

test("a live appeal resolution lease blocks a second admin without reverting the warning", async () => {
  await cleanup();
  const { admin, warningAction } = await setup();

  try {
    const appeal = await prisma.appeal.create({
      data: {
        chatId: warningAction.chatId,
        userId: warningAction.affectedUserId,
        moderationActionId: warningAction.id,
        message: "Причина апелляции",
        resolutionAttemptId: "11111111-1111-4111-8111-111111111111",
        resolutionStartedAt: new Date()
      }
    });

    await assert.rejects(
      resolveAppeal({
        appealId: appeal.id,
        actingAdminId: admin.id,
        decision: "APPROVE"
      }),
      (error: unknown) =>
        error instanceof AppealError &&
        error.code === "APPEAL_IN_PROGRESS" &&
        error.httpStatus === 409
    );

    const [storedAppeal, storedWarning] = await Promise.all([
      prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } }),
      prisma.moderationAction.findUniqueOrThrow({ where: { id: warningAction.id } })
    ]);
    assert.equal(storedAppeal.status, "PENDING");
    assert.equal(storedWarning.revokedAt, null);
  } finally {
    await cleanup();
  }
});

test("a stale appeal resolution lease is reclaimed and cleared on completion", async () => {
  await cleanup();
  const { admin, warningAction } = await setup();

  try {
    const appeal = await prisma.appeal.create({
      data: {
        chatId: warningAction.chatId,
        userId: warningAction.affectedUserId,
        moderationActionId: warningAction.id,
        message: "Причина апелляции",
        resolutionAttemptId: "22222222-2222-4222-8222-222222222222",
        resolutionStartedAt: new Date(Date.now() - 3 * 60_000)
      }
    });

    const result = await resolveAppeal({
      appealId: appeal.id,
      actingAdminId: admin.id,
      decision: "REJECT",
      comment: "Нарушение подтверждено"
    });
    assert.equal(result.status, "REJECTED");

    const stored = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
    assert.equal(stored.resolutionAttemptId, null);
    assert.equal(stored.resolutionStartedAt, null);
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
