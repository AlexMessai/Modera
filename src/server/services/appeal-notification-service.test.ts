import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  buildAppealCallbackData,
  DEFAULT_APPEAL_MESSAGES,
  getAppealMessages,
  notifyAdminsOfNewAppeal,
  notifyAppealDecision,
  parseAppealCallbackData
} from "./appeal-notification-service";
import { updateChatAppealProfile } from "./chat-appeal-settings-service";

test("appeal callback data round-trips through build/parse", () => {
  const appealId = "9c4b8a2e-1f3d-4a5b-8c6e-7d8f9a0b1c2d";
  assert.deepEqual(parseAppealCallbackData(buildAppealCallbackData(appealId, "APPROVE")), {
    appealId,
    decision: "APPROVE"
  });
  assert.deepEqual(parseAppealCallbackData(buildAppealCallbackData(appealId, "REJECT")), {
    appealId,
    decision: "REJECT"
  });
  assert.equal(parseAppealCallbackData("captcha:12345"), null);
  assert.equal(parseAppealCallbackData("appeal:not-a-uuid:APPROVE"), null);
});

test("getAppealMessages falls back to app defaults when no GlobalAppealSettings row exists", async () => {
  // GlobalAppealSettings is a shared singleton row other test files could
  // also touch -- this only asserts the shape/fallback, not exact values.
  const messages = await getAppealMessages();
  assert.equal(typeof messages.appealSubmittedMessageTemplate, "string");
  assert.equal(typeof messages.appealNotifyAdminsMessageTemplate, "string");
  assert.equal(typeof messages.appealApprovedMessageTemplate, "string");
  assert.equal(typeof messages.appealRejectedMessageTemplate, "string");
  assert.ok(messages.appealSubmittedMessageTemplate.length > 0);
});

test("DEFAULT_APPEAL_MESSAGES matches getAppealMessages' own fallback shape", async () => {
  const messages = await getAppealMessages();
  for (const key of Object.keys(DEFAULT_APPEAL_MESSAGES) as (keyof typeof DEFAULT_APPEAL_MESSAGES)[]) {
    assert.equal(typeof messages[key], "string");
  }
});

const CHAT_ID = -1009000015101n;
const ADMIN_EMAIL = "appeal-notify-toggle-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("notifyAppealDecision / notifyAdminsOfNewAppeal skip the Telegram call entirely when the chat's toggle is off", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Appeal Notify Toggle CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    await updateChatAppealProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { enabled: true, notifyAdminsOnSubmit: false, notifyUserOnDecision: false }
    });

    // With both notify flags off, neither function should even attempt a
    // Telegram call -- if it did, getTelegramClient() would throw (no
    // TELEGRAM_BOT_TOKEN in CI) and these awaits would reject instead of
    // resolving cleanly.
    const decisionResult = await notifyAppealDecision({
      chatId: chat.id,
      telegramUserId: 900001510n,
      chatTitle: chat.title,
      decision: "APPROVED",
      comment: null
    });
    assert.equal(decisionResult.delivered, false);

    await assert.doesNotReject(
      notifyAdminsOfNewAppeal({
        chatId: chat.id,
        appealId: "9c4b8a2e-1f3d-4a5b-8c6e-7d8f9a0b1c2d",
        chatTitle: chat.title,
        userDisplayName: "Test User",
        actionType: "WARNING",
        message: "test"
      })
    );
  } finally {
    await cleanup();
  }
});
