import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  JoinRequestMiniAppError,
  listJoinRequests,
  recordTelegramJoinRequest,
  resolveGuardBotJoinRequest,
  resolveJoinRequestFromMiniApp
} from "./join-request-service";

test("Telegram join request ingestion is idempotent by update id", async () => {
  const telegramChatId = -1009000001001n;
  const telegramUserId = 9000001001n;
  const updateId = 910001001;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "Join Request CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId,
      firstName: "Join",
      displayName: "Join Request User"
    }
  });

  const request = {
    chat: { id: Number(telegramChatId), type: "supergroup", title: "Join Request CI" },
    from: {
      id: Number(telegramUserId),
      is_bot: false,
      first_name: "Join"
    },
    user_chat_id: 9000001101,
    date: Math.floor(Date.now() / 1000),
    bio: "CI bio",
    invite_link: { invite_link: "https://t.me/+private-ci-token", creates_join_request: true }
  };

  try {
    const first = await recordTelegramJoinRequest({ chatId: chat.id, request, updateId });
    const second = await recordTelegramJoinRequest({ chatId: chat.id, request, updateId });
    assert.ok(first);
    assert.ok(second);
    assert.equal(first?.id, second?.id);

    const count = await prisma.joinRequest.count({
      where: { telegramUpdateId: BigInt(updateId) }
    });
    assert.equal(count, 1);

    const inbox = await listJoinRequests({
      page: 1,
      pageSize: 20,
      status: "PENDING",
      chatId: chat.id
    });
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]?.user.id, user.id);
    assert.equal(inbox.items[0]?.bio, "CI bio");
    assert.equal(inbox.items[0]?.hasInviteLink, true);
    assert.equal("inviteLink" in (inbox.items[0] ?? {}), false);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});

test("guard-bot resolution leaves the request pending when Telegram can't be reached", async () => {
  // No TELEGRAM_BOT_TOKEN in CI (see CLAUDE.md), so getTelegramClient()
  // throws deterministically — resolveGuardBotJoinRequest must leave the
  // JoinRequest/ChatMember state untouched rather than claim a decision
  // that never actually reached Telegram.
  const telegramChatId = -1009000001002n;
  const telegramUserId = 9000001002n;
  const updateId = 910001002;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "Guard Bot CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId, firstName: "Guard", displayName: "Guard Bot User" }
  });

  const request = {
    chat: { id: Number(telegramChatId), type: "supergroup", title: "Guard Bot CI" },
    from: { id: Number(telegramUserId), is_bot: false, first_name: "Guard" },
    user_chat_id: 9000001102,
    date: Math.floor(Date.now() / 1000),
    query_id: "ci-query-id"
  };

  try {
    const joinRequest = await recordTelegramJoinRequest({ chatId: chat.id, request, updateId });
    await resolveGuardBotJoinRequest({ chatId: chat.id, joinRequestId: joinRequest.id, request });

    const stored = await prisma.joinRequest.findUniqueOrThrow({ where: { id: joinRequest.id } });
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.resolvedAt, null);

    const failure = await prisma.auditLog.findFirst({
      where: { chatId: chat.id, action: "JOIN_REQUEST_AUTO_RESOLUTION_FAILED" }
    });
    assert.ok(failure);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});

test("Mini App confirmation is rejected outright without a configured bot token", async () => {
  // No TELEGRAM_BOT_TOKEN in CI (see CLAUDE.md) — resolveJoinRequestFromMiniApp
  // must fail closed before it ever tries to verify a signature.
  await assert.rejects(
    () => resolveJoinRequestFromMiniApp("query_id=x&user=%7B%7D&auth_date=0&hash=x"),
    (error: unknown) => error instanceof JoinRequestMiniAppError && error.code === "MINI_APP_UNAVAILABLE"
  );
});