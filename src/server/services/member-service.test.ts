import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  getMemberProfile,
  isMembershipStatus,
  mapTelegramMembershipStatus,
  syncMemberStatus
} from "./member-service";

test("Telegram membership statuses map to internal statuses", () => {
  assert.equal(mapTelegramMembershipStatus("creator"), "CREATOR");
  assert.equal(mapTelegramMembershipStatus("administrator"), "ADMINISTRATOR");
  assert.equal(mapTelegramMembershipStatus("member"), "MEMBER");
  assert.equal(mapTelegramMembershipStatus("restricted"), "RESTRICTED");
  assert.equal(mapTelegramMembershipStatus("left"), "LEFT");
  assert.equal(mapTelegramMembershipStatus("kicked"), "BANNED");
  assert.equal(mapTelegramMembershipStatus("future_status"), "UNKNOWN");
});

test("member status filter only accepts supported values", () => {
  assert.equal(isMembershipStatus("MEMBER"), true);
  assert.equal(isMembershipStatus("PENDING"), true);
  assert.equal(isMembershipStatus("BANNED"), true);
  assert.equal(isMembershipStatus("member"), false);
  assert.equal(isMembershipStatus("INVALID"), false);
});

test("older Telegram update cannot overwrite newer membership status", async () => {
  const telegramChatId = -1009000000001n;
  const telegramUserId = 900000001;
  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "CI ordering chat",
      type: "supergroup"
    }
  });

  const user = {
    id: telegramUserId,
    is_bot: false,
    first_name: "Ordering",
    username: "ordering_test"
  } as const;

  try {
    await syncMemberStatus({
      chatId: chat.id,
      member: { status: "member", user },
      date: 1_700_000_000,
      updateId: 200
    });
    await syncMemberStatus({
      chatId: chat.id,
      member: { status: "kicked", user },
      date: 1_700_000_002,
      updateId: 202
    });
    await syncMemberStatus({
      chatId: chat.id,
      member: { status: "member", user },
      date: 1_700_000_001,
      updateId: 201
    });

    const membership = await prisma.chatMember.findFirstOrThrow({
      where: {
        chatId: chat.id,
        user: { telegramUserId: BigInt(telegramUserId) }
      }
    });

    assert.equal(membership.status, "BANNED");
    assert.equal(membership.lastTelegramUpdateId, 202n);
    assert.equal(membership.lastSeenAt.getTime(), 1_700_000_002_000);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.deleteMany({
      where: { telegramUserId: BigInt(telegramUserId) }
    });
  }
});

test("invalid member profile id returns not found without querying UUID", async () => {
  assert.equal(await getMemberProfile("not-a-uuid"), null);
});
