import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  MemberTagError,
  normalizeMemberTag,
  updateTelegramMemberTag
} from "./member-tag-service";

test("member tag validation follows Telegram limits", () => {
  assert.equal(normalizeMemberTag("  5 этаж  "), "5 этаж");
  assert.equal(normalizeMemberTag(""), null);
  assert.throws(
    () => normalizeMemberTag("🏠 5 этаж"),
    (error) =>
      error instanceof MemberTagError && error.code === "TAG_EMOJI_NOT_ALLOWED"
  );
  assert.throws(
    () => normalizeMemberTag("12345678901234567"),
    (error) => error instanceof MemberTagError && error.code === "TAG_TOO_LONG"
  );
});

test("owner tag change reaches Telegram, database and audit log", async () => {
  const suffix = Date.now();
  const admin = await prisma.adminUser.create({
    data: {
      email: `member-tag-${suffix}@example.com`,
      passwordHash: "test-hash",
      displayName: "Tag Owner",
      role: "OWNER"
    }
  });
  const chat = await prisma.chat.create({
    data: {
      telegramChatId: BigInt(-1009100000000 - (suffix % 100000)),
      title: "Member tag service chat",
      type: "supergroup"
    }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId: BigInt(910000000 + (suffix % 100000)),
      firstName: "Tagged",
      displayName: "Tagged Member"
    }
  });
  const membership = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER" }
  });
  const calls: Array<{ chatId: number; userId: number; tag: string }> = [];
  const client = {
    async getChatMember(_chatId: number, telegramUserId: number) {
      if (telegramUserId === 777) {
        return {
          status: "administrator" as const,
          user: { id: 777, is_bot: true, first_name: "Bot" },
          can_manage_tags: true
        };
      }
      return {
        status: "member" as const,
        user: {
          id: telegramUserId,
          is_bot: false,
          first_name: "Tagged"
        }
      };
    },
    async setChatMemberTag(input: { chatId: number; userId: number; tag: string }) {
      calls.push(input);
      return true;
    }
  };

  try {
    const result = await updateTelegramMemberTag(
      {
        membershipId: membership.id,
        actingAdminId: admin.id,
        tag: "Designer"
      },
      { client, botTelegramId: 777 }
    );

    assert.equal(result.tag, "Designer");
    assert.equal(calls[0]?.tag, "Designer");
    assert.equal(
      (await prisma.chatMemberTag.findUniqueOrThrow({
        where: { chatMemberId: membership.id }
      })).tag,
      "Designer"
    );
    assert.equal(
      (await prisma.auditLog.findFirstOrThrow({
        where: { affectedUserId: user.id, action: "MEMBER_TAG_UPDATED" }
      })).actingAdminId,
      admin.id
    );

    await updateTelegramMemberTag(
      {
        membershipId: membership.id,
        actingAdminId: admin.id,
        tag: null
      },
      { client, botTelegramId: 777 }
    );
    assert.equal(calls[1]?.tag, "");
    assert.equal(
      await prisma.chatMemberTag.findUnique({
        where: { chatMemberId: membership.id }
      }),
      null
    );
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
    await prisma.adminUser.delete({ where: { id: admin.id } });
  }
});
