import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_ROLE_DEFINITIONS,
  ensureDefaultRolesForChat,
  hasChatPermission,
  resolveChatPermissions,
  syncAutoChatRole
} from "./chat-role-service";

async function fixtureChat(suffix: number) {
  return prisma.chat.create({
    data: {
      telegramChatId: BigInt(-1009000000900 - suffix),
      title: `Chat role CI ${suffix}`,
      type: "supergroup"
    }
  });
}

async function fixtureMember(chatId: string, telegramUserId: number) {
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: BigInt(telegramUserId), firstName: "CI", displayName: `CI ${telegramUserId}` }
  });
  const member = await prisma.chatMember.create({
    data: { chatId, userId: user.id, status: "MEMBER" }
  });
  return { user, member };
}

test("ensureDefaultRolesForChat seeds all five roles exactly once", async () => {
  const chat = await fixtureChat(1);
  try {
    await ensureDefaultRolesForChat(chat.id);
    const firstPass = await prisma.chatRole.findMany({ where: { chatId: chat.id } });
    assert.equal(firstPass.length, 5);
    assert.deepEqual(
      new Set(firstPass.map((role) => role.key)),
      new Set(["owner", "admin", "moderator", "trusted", "member"])
    );

    // Calling again must not create duplicates or throw on the unique (chatId, key) index.
    await ensureDefaultRolesForChat(chat.id);
    const secondPass = await prisma.chatRole.findMany({ where: { chatId: chat.id } });
    assert.equal(secondPass.length, 5);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
  }
});

test("syncAutoChatRole assigns owner/admin/trusted/member from live status, and resolveChatPermissions reflects it", async () => {
  const chat = await fixtureChat(2);
  try {
    const owner = await fixtureMember(chat.id, 900000901);
    const admin = await fixtureMember(chat.id, 900000902);
    const trusted = await fixtureMember(chat.id, 900000903);
    const plain = await fixtureMember(chat.id, 900000904);

    await syncAutoChatRole({ chatId: chat.id, membershipId: owner.member.id, status: "CREATOR", isTrusted: false });
    await syncAutoChatRole({ chatId: chat.id, membershipId: admin.member.id, status: "ADMINISTRATOR", isTrusted: false });
    await syncAutoChatRole({ chatId: chat.id, membershipId: trusted.member.id, status: "MEMBER", isTrusted: true });
    await syncAutoChatRole({ chatId: chat.id, membershipId: plain.member.id, status: "MEMBER", isTrusted: false });

    const ownerPermissions = await resolveChatPermissions(chat.id, 900000901);
    assert.deepEqual([...ownerPermissions].sort(), [...DEFAULT_ROLE_DEFINITIONS.owner.permissions].sort());
    assert.ok(ownerPermissions.has("roles.manage"));

    const adminPermissions = await resolveChatPermissions(chat.id, 900000902);
    assert.ok(adminPermissions.has("moderation.ban"));
    assert.ok(!adminPermissions.has("roles.manage"));

    const trustedPermissions = await resolveChatPermissions(chat.id, 900000903);
    assert.equal(trustedPermissions.size, 0);

    const plainPermissions = await resolveChatPermissions(chat.id, 900000904);
    assert.equal(plainPermissions.size, 0);

    // A member with no ChatMember row at all (never observed) also just gets nothing, not an error.
    const unknownPermissions = await resolveChatPermissions(chat.id, 999999999);
    assert.equal(unknownPermissions.size, 0);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.deleteMany({
      where: { telegramUserId: { in: [900000901, 900000902, 900000903, 900000904].map(BigInt) } }
    });
  }
});

test("syncAutoChatRole never overrides a manually-assigned role", async () => {
  const chat = await fixtureChat(3);
  try {
    const { member } = await fixtureMember(chat.id, 900000905);
    await ensureDefaultRolesForChat(chat.id);
    const moderatorRole = await prisma.chatRole.findUniqueOrThrow({
      where: { chatId_key: { chatId: chat.id, key: "moderator" } }
    });

    await prisma.chatMember.update({
      where: { id: member.id },
      data: { chatRoleId: moderatorRole.id, chatRoleAssignedBy: "MANUAL" }
    });

    // Telegram now reports this member as a live admin, but the manual
    // assignment must stick — auto-sync only ever touches AUTO/unset members.
    await syncAutoChatRole({ chatId: chat.id, membershipId: member.id, status: "ADMINISTRATOR", isTrusted: false });

    const after = await prisma.chatMember.findUniqueOrThrow({ where: { id: member.id } });
    assert.equal(after.chatRoleId, moderatorRole.id);
    assert.equal(after.chatRoleAssignedBy, "MANUAL");
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.deleteMany({ where: { telegramUserId: 900000905n } });
  }
});

test("hasChatPermission grants purely from an assigned role, no Telegram call needed", async () => {
  const chat = await fixtureChat(4);
  try {
    const { member } = await fixtureMember(chat.id, 900000906);
    await syncAutoChatRole({ chatId: chat.id, membershipId: member.id, status: "MEMBER", isTrusted: false });

    // A custom role can grant a moderation permission to someone who isn't
    // a live Telegram admin at all — this is the whole point of the model.
    const customRole = await prisma.chatRole.create({
      data: { chatId: chat.id, key: "junior-moderator", label: "Junior Moderator", isCustom: true, permissions: ["moderation.warn"] }
    });
    await prisma.chatMember.update({
      where: { id: member.id },
      data: { chatRoleId: customRole.id, chatRoleAssignedBy: "MANUAL" }
    });

    assert.equal(
      await hasChatPermission({ chatId: chat.id, chatTelegramId: -1, telegramUserId: 900000906, permission: "moderation.warn" }),
      true
    );
    // The role doesn't grant moderation.ban, and this member has no live
    // Telegram admin status either (CI has no bot token, so the fallback
    // check fails closed) — must come back false, not throw.
    assert.equal(
      await hasChatPermission({ chatId: chat.id, chatTelegramId: -1, telegramUserId: 900000906, permission: "moderation.ban" }),
      false
    );
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.deleteMany({ where: { telegramUserId: 900000906n } });
  }
});

test("hasChatPermission with no role data falls back to a live check for moderation/history/users permissions only", async () => {
  const chat = await fixtureChat(5);
  try {
    // No ChatMember row at all for this Telegram user — nothing to fall
    // back from except the (CI: token-less, fails closed) live check.
    assert.equal(
      await hasChatPermission({ chatId: chat.id, chatTelegramId: -1, telegramUserId: 900000907, permission: "moderation.mute" }),
      false
    );
    assert.equal(
      await hasChatPermission({ chatId: chat.id, chatTelegramId: -1, telegramUserId: 900000907, permission: "history.view" }),
      false
    );
    // roles.manage/settings.manage/automod.manage/logs.view are web-panel-
    // only — no live-Telegram-admin fallback, so this must be false purely
    // from having no role, without even attempting a Telegram call.
    assert.equal(
      await hasChatPermission({ chatId: chat.id, chatTelegramId: -1, telegramUserId: 900000907, permission: "roles.manage" }),
      false
    );
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
  }
});
