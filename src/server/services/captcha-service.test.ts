import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  captchaCallbackData,
  parseCaptchaCallbackData,
  processExpiredCaptchaChallenges,
  verifyCaptchaChallenge
} from "./captcha-service";

test("captcha callback data round-trips a Telegram user id", () => {
  assert.equal(captchaCallbackData(900000301n), "captcha:900000301");
  assert.equal(parseCaptchaCallbackData("captcha:900000301"), 900000301);
  assert.equal(parseCaptchaCallbackData("captcha:not-a-number"), null);
  assert.equal(parseCaptchaCallbackData("other:900000301"), null);
});

test("verification rejects a mismatched Telegram user without touching Telegram or the database", async () => {
  const result = await verifyCaptchaChallenge({
    chatId: "00000000-0000-4000-8000-000000000000",
    telegramChatId: -1009000013001n,
    fromTelegramUserId: 1,
    targetTelegramUserId: 2
  });
  assert.equal(result.outcome, "wrong_user");
});

test("verification reports not_found for an unknown Telegram user", async () => {
  const telegramUserId = 900000398n;
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const result = await verifyCaptchaChallenge({
    chatId: "00000000-0000-4000-8000-000000000000",
    telegramChatId: -1009000013001n,
    fromTelegramUserId: Number(telegramUserId),
    targetTelegramUserId: Number(telegramUserId)
  });
  assert.equal(result.outcome, "not_found");
});

test("verification reports not_pending when the member is not awaiting captcha", async () => {
  const telegramChatId = -1009000013002n;
  const telegramUserId = 900000302n;
  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });
  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "Captcha Verify CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId, firstName: "Verify", displayName: "Verify" }
  });
  await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER" }
  });

  try {
    const result = await verifyCaptchaChallenge({
      chatId: chat.id,
      telegramChatId,
      fromTelegramUserId: Number(telegramUserId),
      targetTelegramUserId: Number(telegramUserId)
    });
    assert.equal(result.outcome, "not_pending");
  } finally {
    await prisma.chat.deleteMany({ where: { telegramChatId } });
    await prisma.telegramUser.deleteMany({ where: { telegramUserId } });
  }
});

test("expiration sweep reports a consistent shape when nothing is pending", async () => {
  const result = await processExpiredCaptchaChallenges({
    now: new Date("2026-08-19T00:00:00.000Z"),
    limit: 5
  });
  assert.equal(typeof result.checked, "number");
  assert.ok(result.kicked >= 0);
  assert.ok(result.failed >= 0);
  assert.equal(result.checked, result.kicked + result.failed);
});
