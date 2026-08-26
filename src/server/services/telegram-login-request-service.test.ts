import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  createTelegramLoginRequest,
  getTelegramLoginRequestStatus,
  resolveTelegramLoginRequest
} from "./telegram-login-request-service";

const CHAT_TELEGRAM_ID = -1009000015001n;
const BOT_TELEGRAM_ID = 900002001n;
const ADMIN_TELEGRAM_ID = 900003001;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_TELEGRAM_ID } });
  await prisma.telegramBot.deleteMany({ where: { telegramBotId: BOT_TELEGRAM_ID } });
  await prisma.adminUser.deleteMany({ where: { telegramUserId: BigInt(ADMIN_TELEGRAM_ID) } });
}

test("resolveTelegramLoginRequest self-registers a Telegram user who administers a bot chat, and is single-use", async () => {
  await cleanup();

  const bot = await prisma.telegramBot.create({
    data: { telegramBotId: BOT_TELEGRAM_ID, username: "modera_ci_bot", firstName: "Modera CI" }
  });
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_TELEGRAM_ID, title: "Telegram Login CI", type: "supergroup" }
  });
  await prisma.botChat.create({
    data: { botId: bot.id, chatId: chat.id, status: "ACTIVE" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: BigInt(ADMIN_TELEGRAM_ID), firstName: "CI", displayName: "CI Admin" }
  });
  await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "CREATOR", joinedAt: new Date() }
  });

  try {
    const { token } = await createTelegramLoginRequest();

    const beforeResolve = await getTelegramLoginRequestStatus(token);
    assert.equal(beforeResolve.status, "pending");

    const resolved = await resolveTelegramLoginRequest(token, { id: ADMIN_TELEGRAM_ID, username: "ci_admin" });
    assert.equal(resolved.outcome, "ok");

    const admin = await prisma.adminUser.findUnique({ where: { telegramUserId: BigInt(ADMIN_TELEGRAM_ID) } });
    assert.ok(admin);
    assert.equal(admin?.scope, "CHAT");
    const access = await prisma.chatAdminAccess.findUnique({ where: { chatId_adminId: { chatId: chat.id, adminId: admin!.id } } });
    assert.equal(access?.role, "OWNER");
    assert.equal(access?.grantedVia, "AUTO");

    const afterResolve = await getTelegramLoginRequestStatus(token);
    assert.equal(afterResolve.status, "completed");
    assert.equal(afterResolve.status === "completed" && afterResolve.adminId, admin!.id);

    // Single-use: resolving the same token again finds nothing PENDING left to match.
    const reused = await resolveTelegramLoginRequest(token, { id: ADMIN_TELEGRAM_ID });
    assert.equal(reused.outcome, "not_found");
  } finally {
    await cleanup();
  }
});

test("resolveTelegramLoginRequest fails for a Telegram user who administers no bot chat", async () => {
  await cleanup();
  try {
    const { token } = await createTelegramLoginRequest();
    const resolved = await resolveTelegramLoginRequest(token, { id: ADMIN_TELEGRAM_ID });
    assert.equal(resolved.outcome, "no_admin_chats");

    const status = await getTelegramLoginRequestStatus(token);
    assert.equal(status.status, "failed");
    assert.equal(status.status === "failed" && status.errorCode, "no_admin_chats");
  } finally {
    await cleanup();
  }
});

test("resolveTelegramLoginRequest treats an unknown or expired token as not found", async () => {
  const resolved = await resolveTelegramLoginRequest("not-a-real-token", { id: ADMIN_TELEGRAM_ID });
  assert.equal(resolved.outcome, "not_found");

  const status = await getTelegramLoginRequestStatus("not-a-real-token");
  assert.equal(status.status, "not_found");
});
