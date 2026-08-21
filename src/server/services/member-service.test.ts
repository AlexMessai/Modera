import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  getMemberProfile,
  isMembershipStatus,
  mapTelegramMembershipStatus,
  resolveTelegramTargets,
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

test("Telegram event older than manual moderation cannot regress status", async () => {
  const telegramChatId = -1009000000002n;
  const telegramUserId = 900000002;
  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "CI manual ordering chat",
      type: "supergroup"
    }
  });

  const user = {
    id: telegramUserId,
    is_bot: false,
    first_name: "Manual ordering"
  } as const;

  try {
    await syncMemberStatus({
      chatId: chat.id,
      member: { status: "member", user },
      date: 1_700_000_100,
      updateId: 300
    });

    const existing = await prisma.chatMember.findFirstOrThrow({
      where: {
        chatId: chat.id,
        user: { telegramUserId: BigInt(telegramUserId) }
      }
    });

    await prisma.chatMember.update({
      where: { id: existing.id },
      data: {
        status: "BANNED",
        punishmentState: "BANNED",
        lastModerationAt: new Date(1_700_000_200_500)
      }
    });

    await syncMemberStatus({
      chatId: chat.id,
      member: { status: "member", user },
      date: 1_700_000_150,
      updateId: 999
    });

    const after = await prisma.chatMember.findUniqueOrThrow({
      where: { id: existing.id }
    });

    assert.equal(after.status, "BANNED");
    assert.equal(after.punishmentState, "BANNED");
    assert.equal(after.lastTelegramUpdateId, 300n);
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

test("Telegram profile, member tag and administrator title stay chat-scoped", async () => {
  const telegramChatId = -1009000000003n;
  const telegramUserId = 900000003;
  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "CI member tag chat",
      type: "supergroup"
    }
  });

  try {
    await syncMemberStatus({
      chatId: chat.id,
      member: {
        status: "member",
        tag: "Designer",
        user: {
          id: telegramUserId,
          is_bot: false,
          first_name: "Premium",
          is_premium: true,
          added_to_attachment_menu: true
        }
      },
      date: 1_700_000_300,
      updateId: 400
    });

    const tagged = await prisma.chatMember.findFirstOrThrow({
      where: { chatId: chat.id },
      include: { memberTag: true, user: true }
    });
    assert.equal(tagged.memberTag?.tag, "Designer");
    assert.equal(tagged.user.isPremium, true);
    assert.equal(tagged.user.addedToAttachmentMenu, true);

    await syncMemberStatus({
      chatId: chat.id,
      member: {
        status: "administrator",
        custom_title: "Curator",
        user: {
          id: telegramUserId,
          is_bot: false,
          first_name: "Premium",
          is_premium: true
        }
      },
      date: 1_700_000_301,
      updateId: 401
    });

    const promoted = await prisma.chatMember.findUniqueOrThrow({
      where: { id: tagged.id },
      include: { memberTag: true }
    });
    assert.equal(promoted.memberTag, null);
    assert.equal(promoted.telegramCustomTitle, "Curator");
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.deleteMany({
      where: { telegramUserId: BigInt(telegramUserId) }
    });
  }
});

test("resolveTelegramTargets resolves @username/ID only within the given chat and reports unresolved usernames", async () => {
  const telegramChatId = -1009000000010n;
  const knownUserId = 900000010;
  const otherChatUserId = 900000011;
  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "CI target-resolution chat", type: "supergroup" }
  });
  const otherChat = await prisma.chat.create({
    data: { telegramChatId: -1009000000011n, title: "CI other chat", type: "supergroup" }
  });

  try {
    await syncMemberStatus({
      chatId: chat.id,
      member: { status: "member", user: { id: knownUserId, is_bot: false, first_name: "Known", username: "known_target" } },
      date: 1_700_000_400,
      updateId: 500
    });
    await syncMemberStatus({
      chatId: otherChat.id,
      member: { status: "member", user: { id: otherChatUserId, is_bot: false, first_name: "Elsewhere", username: "elsewhere_target" } },
      date: 1_700_000_401,
      updateId: 501
    });

    const result = await resolveTelegramTargets({
      chatId: chat.id,
      tokens: [
        { type: "username", value: "KNOWN_TARGET" },
        { type: "username", value: "elsewhere_target" },
        { type: "username", value: "does_not_exist" },
        { type: "id", value: knownUserId }
      ]
    });

    assert.equal(result.resolved.length, 2);
    assert.ok(result.resolved.every((entry) => entry.telegramUserId === knownUserId));
    assert.ok(result.resolved.every((entry) => entry.displayName === "Known"));
    assert.deepEqual(result.resolved.map((entry) => entry.token.type).sort(), ["id", "username"]);
    assert.deepEqual(result.unresolvedUsernames.sort(), ["does_not_exist", "elsewhere_target"]);
  } finally {
    await prisma.chat.deleteMany({ where: { id: { in: [chat.id, otherChat.id] } } });
    await prisma.telegramUser.deleteMany({
      where: { telegramUserId: { in: [BigInt(knownUserId), BigInt(otherChatUserId)] } }
    });
  }
});
