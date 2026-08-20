import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  listJoinRequests,
  recordTelegramJoinRequest
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