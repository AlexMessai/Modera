import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  canAdminModerateChat,
  ChatAdminAccessError,
  grantChatAccessByUsername,
  listChatsForAdmin,
  listChatTeam,
  listTelegramModeratorsForChat,
  resolveTelegramUserByHandle,
  revokeChatAccess,
  syncAutoChatAdminAccess,
  updateChatAccessRole
} from "./chat-admin-access-service";

const CHAT_ID = -1009000015001n;
const OTHER_CHAT_ID = -1009000015002n;
const KNOWN_TELEGRAM_USER_ID = 900001501n;
const GLOBAL_ADMIN_EMAIL = "chat-admin-access-service-ci@example.com";
const KNOWN_USERNAME = "chat_admin_access_ci_user";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: { in: [CHAT_ID, OTHER_CHAT_ID] } } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: KNOWN_TELEGRAM_USER_ID } });
  await prisma.adminUser.deleteMany({ where: { email: GLOBAL_ADMIN_EMAIL } });
  await prisma.adminUser.deleteMany({ where: { telegramUserId: KNOWN_TELEGRAM_USER_ID } });
  await prisma.telegramBot.deleteMany({ where: { telegramBotId: 900004001n } });
}

async function setup() {
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Chat Admin Access CI", type: "supergroup" }
  });
  const otherChat = await prisma.chat.create({
    data: { telegramChatId: OTHER_CHAT_ID, title: "Chat Admin Access CI (other)", type: "supergroup" }
  });
  const knownUser = await prisma.telegramUser.create({
    data: {
      telegramUserId: KNOWN_TELEGRAM_USER_ID,
      username: KNOWN_USERNAME,
      firstName: "CI",
      displayName: "CI Known User"
    }
  });
  const globalAdmin = await prisma.adminUser.create({
    data: { email: GLOBAL_ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  // grantChatAccessByUsername now requires the target to currently be a live
  // Telegram admin of the chat they're being granted access to -- most tests
  // below need this in place for `chat` (not `otherChat`, which stays
  // available for testing the "not an admin here" rejection).
  const knownUserMembership = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: knownUser.id, status: "ADMINISTRATOR", joinedAt: new Date() }
  });
  return { chat, otherChat, knownUser, knownUserMembership, globalAdmin };
}

test("resolveTelegramUserByHandle: @-strip, case-insensitive username, numeric id, unknown returns null", async () => {
  await cleanup();
  const { knownUser } = await setup();
  try {
    const byAt = await resolveTelegramUserByHandle(`@${KNOWN_USERNAME}`);
    assert.equal(byAt?.id, knownUser.id);

    const byCase = await resolveTelegramUserByHandle(KNOWN_USERNAME.toUpperCase());
    assert.equal(byCase?.id, knownUser.id);

    const byNumeric = await resolveTelegramUserByHandle(KNOWN_TELEGRAM_USER_ID.toString());
    assert.equal(byNumeric?.id, knownUser.id);

    const unknown = await resolveTelegramUserByHandle("nobody_knows_this_handle");
    assert.equal(unknown, null);
  } finally {
    await cleanup();
  }
});

test("grantChatAccessByUsername rejects an unknown username with a typed, honest error (no pending-invite path)", async () => {
  await cleanup();
  const { chat, globalAdmin } = await setup();
  try {
    await assert.rejects(
      () =>
        grantChatAccessByUsername({
          chatId: chat.id,
          actingAdminId: globalAdmin.id,
          handle: "someone_the_bot_has_never_seen",
          role: "ADMIN"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ChatAdminAccessError);
        assert.equal(error.code, "TELEGRAM_USER_UNKNOWN");
        assert.equal(error.httpStatus, 422);
        return true;
      }
    );
  } finally {
    await cleanup();
  }
});

test("grantChatAccessByUsername rejects a known user who isn't currently a Telegram admin of this chat", async () => {
  await cleanup();
  const { otherChat, globalAdmin } = await setup();
  try {
    // `otherChat` deliberately has no ChatMember row for knownUser at all.
    await assert.rejects(
      () =>
        grantChatAccessByUsername({
          chatId: otherChat.id,
          actingAdminId: globalAdmin.id,
          handle: KNOWN_USERNAME,
          role: "ADMIN"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ChatAdminAccessError);
        assert.equal(error.code, "NOT_CHAT_ADMIN");
        return true;
      }
    );
  } finally {
    await cleanup();
  }
});

test("grantChatAccessByUsername and updateChatAccessRole both reject the OWNER role -- it's never manually assignable", async () => {
  await cleanup();
  const { chat, globalAdmin } = await setup();
  try {
    await assert.rejects(
      () =>
        grantChatAccessByUsername({
          chatId: chat.id,
          actingAdminId: globalAdmin.id,
          handle: KNOWN_USERNAME,
          role: "OWNER"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ChatAdminAccessError);
        assert.equal(error.code, "OWNER_ROLE_NOT_GRANTABLE");
        return true;
      }
    );

    const granted = await grantChatAccessByUsername({
      chatId: chat.id,
      actingAdminId: globalAdmin.id,
      handle: KNOWN_USERNAME,
      role: "ADMIN"
    });

    await assert.rejects(
      () =>
        updateChatAccessRole({
          chatId: chat.id,
          actingAdminId: globalAdmin.id,
          accessId: granted.id,
          role: "OWNER"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ChatAdminAccessError);
        assert.equal(error.code, "OWNER_ROLE_NOT_GRANTABLE");
        return true;
      }
    );
  } finally {
    await cleanup();
  }
});

test("updateChatAccessRole and revokeChatAccess both reject an admin acting on their own access row", async () => {
  await cleanup();
  const { chat, globalAdmin } = await setup();
  try {
    const granted = await grantChatAccessByUsername({
      chatId: chat.id,
      actingAdminId: globalAdmin.id,
      handle: KNOWN_USERNAME,
      role: "ADMIN"
    });

    await assert.rejects(
      () =>
        updateChatAccessRole({
          chatId: chat.id,
          actingAdminId: granted.adminId,
          accessId: granted.id,
          role: "MODERATOR"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ChatAdminAccessError);
        assert.equal(error.code, "CANNOT_MODIFY_SELF");
        return true;
      }
    );

    await assert.rejects(
      () => revokeChatAccess({ chatId: chat.id, actingAdminId: granted.adminId, accessId: granted.id }),
      (error: unknown) => {
        assert.ok(error instanceof ChatAdminAccessError);
        assert.equal(error.code, "CANNOT_MODIFY_SELF");
        return true;
      }
    );

    // Untouched -- neither rejected call should have mutated or deleted the row.
    const stillThere = await prisma.chatAdminAccess.findUnique({ where: { id: granted.id } });
    assert.equal(stillThere?.role, "ADMIN");
  } finally {
    await cleanup();
  }
});

test("grantChatAccessByUsername/updateChatAccessRole/revokeChatAccess round-trip, and listChatTeam reflects it", async () => {
  await cleanup();
  const { chat, globalAdmin, knownUser } = await setup();
  try {
    const granted = await grantChatAccessByUsername({
      chatId: chat.id,
      actingAdminId: globalAdmin.id,
      handle: `@${KNOWN_USERNAME}`,
      role: "ADMIN"
    });
    assert.equal(granted.role, "ADMIN");
    assert.equal(granted.grantedVia, "MANUAL");

    const createdAdmin = await prisma.adminUser.findUnique({ where: { id: granted.adminId } });
    assert.equal(createdAdmin?.scope, "CHAT");
    assert.equal(createdAdmin?.role, "VIEWER");
    assert.equal(createdAdmin?.email, null);
    assert.equal(createdAdmin?.passwordHash, null);
    assert.equal(createdAdmin?.telegramUserId, KNOWN_TELEGRAM_USER_ID);

    const grantLog = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "CHAT_ADMIN_ACCESS_GRANTED" } });
    assert.ok(grantLog);

    const teamAfterGrant = await listChatTeam(chat.id);
    assert.equal(teamAfterGrant.custom.length, 1);
    assert.equal(teamAfterGrant.custom[0].accessId, granted.id);
    assert.equal(teamAfterGrant.custom[0].role, "ADMIN");

    // Calling grant again for the same person (idempotent upsert path) must
    // not create a second AdminUser or a second ChatAdminAccess row.
    const grantedAgain = await grantChatAccessByUsername({
      chatId: chat.id,
      actingAdminId: globalAdmin.id,
      handle: KNOWN_USERNAME,
      role: "MODERATOR"
    });
    assert.equal(grantedAgain.id, granted.id);
    assert.equal(grantedAgain.adminId, granted.adminId);
    assert.equal(grantedAgain.role, "MODERATOR");

    const updated = await updateChatAccessRole({
      chatId: chat.id,
      actingAdminId: globalAdmin.id,
      accessId: granted.id,
      role: "ADMIN"
    });
    assert.equal(updated?.role, "ADMIN");
    const updateLog = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "CHAT_ADMIN_ACCESS_UPDATED" } });
    assert.ok(updateLog);

    const revoked = await revokeChatAccess({ chatId: chat.id, actingAdminId: globalAdmin.id, accessId: granted.id });
    assert.equal(revoked, true);
    const revokeLog = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "CHAT_ADMIN_ACCESS_REVOKED" } });
    assert.ok(revokeLog);

    const teamAfterRevoke = await listChatTeam(chat.id);
    assert.equal(teamAfterRevoke.custom.length, 0);

    // Revoking again (already gone) is a clean no-op, not a throw.
    const revokedAgain = await revokeChatAccess({ chatId: chat.id, actingAdminId: globalAdmin.id, accessId: granted.id });
    assert.equal(revokedAgain, false);

    void knownUser;
  } finally {
    await cleanup();
  }
});

test("updateChatAccessRole/revokeChatAccess reject an accessId that belongs to a different chat", async () => {
  await cleanup();
  const { chat, otherChat, globalAdmin } = await setup();
  try {
    const granted = await grantChatAccessByUsername({
      chatId: chat.id,
      actingAdminId: globalAdmin.id,
      handle: KNOWN_USERNAME,
      role: "ADMIN"
    });

    const updated = await updateChatAccessRole({
      chatId: otherChat.id,
      actingAdminId: globalAdmin.id,
      accessId: granted.id,
      role: "OWNER"
    });
    assert.equal(updated, null);

    const revoked = await revokeChatAccess({ chatId: otherChat.id, actingAdminId: globalAdmin.id, accessId: granted.id });
    assert.equal(revoked, false);

    // The row must still exist, untouched, under its real chat.
    const stillThere = await prisma.chatAdminAccess.findUnique({ where: { id: granted.id } });
    assert.equal(stillThere?.role, "ADMIN");
  } finally {
    await cleanup();
  }
});

test("listChatsForAdmin returns null for a GLOBAL admin and the exact chat-ID array for a CHAT admin", async () => {
  await cleanup();
  const { chat, otherChat, globalAdmin } = await setup();
  try {
    const forGlobal = await listChatsForAdmin(globalAdmin.id);
    assert.equal(forGlobal, null);

    const granted = await grantChatAccessByUsername({
      chatId: chat.id,
      actingAdminId: globalAdmin.id,
      handle: KNOWN_USERNAME,
      role: "ADMIN"
    });

    const forChatAdmin = await listChatsForAdmin(granted.adminId);
    assert.deepEqual(forChatAdmin, [chat.id]);
    assert.ok(!forChatAdmin?.includes(otherChat.id));
  } finally {
    await cleanup();
  }
});

test("syncAutoChatAdminAccess only ever grants for the live CREATOR (not a regular ADMINISTRATOR), revokes on ownership loss, and leaves MANUAL grants alone", async () => {
  await cleanup();
  const { chat, otherChat, globalAdmin, knownUser, knownUserMembership } = await setup();
  try {
    const bot = await prisma.telegramBot.create({
      data: { telegramBotId: 900004001n, username: "chat_admin_access_ci_bot", firstName: "CI Bot" }
    });
    await prisma.botChat.create({ data: { botId: bot.id, chatId: chat.id, status: "ACTIVE" } });
    // Also an admin of `otherChat`, purely so the MANUAL-grant fixture below is
    // allowed under the new "must currently be an admin here" rule.
    await prisma.chatMember.create({
      data: { chatId: otherChat.id, userId: knownUser.id, status: "ADMINISTRATOR", joinedAt: new Date() }
    });
    const chatAdminUser = await prisma.adminUser.create({
      data: {
        scope: "CHAT",
        role: "VIEWER",
        email: null,
        passwordHash: null,
        displayName: knownUser.displayName,
        telegramUserId: KNOWN_TELEGRAM_USER_ID
      }
    });

    // A MANUAL grant for an unrelated chat -- must never be touched by the
    // auto-sync, regardless of direction.
    const manualGrant = await grantChatAccessByUsername({
      chatId: otherChat.id,
      actingAdminId: globalAdmin.id,
      handle: KNOWN_USERNAME,
      role: "MODERATOR"
    });

    // Still just a regular ADMINISTRATOR of `chat` (setup()'s default) --
    // syncing must NOT grant anything for it. Full access is owner-only.
    await syncAutoChatAdminAccess(chatAdminUser.id, KNOWN_TELEGRAM_USER_ID);
    const whileAdministrator = await prisma.chatAdminAccess.findMany({ where: { adminId: chatAdminUser.id } });
    assert.equal(whileAdministrator.length, 1);
    assert.equal(whileAdministrator[0].id, manualGrant.id);

    // Promoted to CREATOR -- now the sync grants AUTO/OWNER for `chat`.
    await prisma.chatMember.update({ where: { id: knownUserMembership.id }, data: { status: "CREATOR" } });
    await syncAutoChatAdminAccess(chatAdminUser.id, KNOWN_TELEGRAM_USER_ID);

    const afterGrant = await prisma.chatAdminAccess.findMany({ where: { adminId: chatAdminUser.id }, orderBy: { chatId: "asc" } });
    assert.equal(afterGrant.length, 2);
    const autoRow = afterGrant.find((row) => row.chatId === chat.id);
    assert.equal(autoRow?.role, "OWNER");
    assert.equal(autoRow?.grantedVia, "AUTO");
    const stillManual = afterGrant.find((row) => row.id === manualGrant.id);
    assert.equal(stillManual?.grantedVia, "MANUAL");
    assert.equal(stillManual?.role, "MODERATOR");

    const syncLog = await prisma.auditLog.findFirst({ where: { actingAdminId: chatAdminUser.id, action: "CHAT_ADMIN_ACCESS_AUTO_SYNCED" } });
    assert.ok(syncLog);

    // Ownership lost (demoted to a regular member) -- the AUTO grant for
    // `chat` must disappear, but the unrelated MANUAL grant must survive.
    await prisma.chatMember.update({ where: { id: knownUserMembership.id }, data: { status: "MEMBER" } });
    await syncAutoChatAdminAccess(chatAdminUser.id, KNOWN_TELEGRAM_USER_ID);

    const afterDemotion = await prisma.chatAdminAccess.findMany({ where: { adminId: chatAdminUser.id } });
    assert.equal(afterDemotion.length, 1);
    assert.equal(afterDemotion[0].id, manualGrant.id);
    assert.equal(afterDemotion[0].grantedVia, "MANUAL");
  } finally {
    await cleanup();
  }
});

test("chat moderation authorization and Telegram recipients respect GLOBAL/CHAT scope", async () => {
  await cleanup();
  const { chat, otherChat, globalAdmin } = await setup();
  try {
    const globalWithTelegram = await prisma.adminUser.update({
      where: { id: globalAdmin.id },
      data: { telegramUserId: 900001599n, role: "MODERATOR" }
    });
    const granted = await grantChatAccessByUsername({
      chatId: chat.id,
      actingAdminId: globalAdmin.id,
      handle: KNOWN_USERNAME,
      role: "MODERATOR"
    });
    const chatAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { id: granted.adminId } });

    assert.equal(await canAdminModerateChat(globalWithTelegram, chat.id), true);
    assert.equal(await canAdminModerateChat(chatAdmin, chat.id), true);
    assert.equal(await canAdminModerateChat(chatAdmin, otherChat.id), false);

    const recipients = await listTelegramModeratorsForChat(chat.id);
    assert.ok(recipients.map(String).includes("900001599"));
    assert.ok(recipients.map(String).includes(KNOWN_TELEGRAM_USER_ID.toString()));

    const otherRecipients = await listTelegramModeratorsForChat(otherChat.id);
    assert.ok(otherRecipients.map(String).includes("900001599"));
    assert.ok(!otherRecipients.map(String).includes(KNOWN_TELEGRAM_USER_ID.toString()));
  } finally {
    await cleanup();
  }
});
