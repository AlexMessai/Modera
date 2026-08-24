import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  executeAdminWarningRevoke,
  executeModerationAction,
  executeTelegramActorModerationAction,
  executeTelegramActorWarningRevoke,
  isModerationAction,
  isProtectedMemberStatus,
  membershipUpdateFor,
  ModerationError,
  requiresReason
} from "./moderation-service";

test("mute/ban duration is validated before any lookup happens", async () => {
  await assert.rejects(
    executeModerationAction({
      membershipId: "does-not-matter",
      actingAdminId: "does-not-matter",
      action: "MUTE",
      reason: "test",
      muteDurationMinutes: 10081
    }),
    (error: unknown) => error instanceof ModerationError && error.code === "INVALID_MUTE_DURATION"
  );
  await assert.rejects(
    executeModerationAction({
      membershipId: "does-not-matter",
      actingAdminId: "does-not-matter",
      action: "BAN",
      reason: "test",
      banDurationMinutes: 366 * 24 * 60 + 1
    }),
    (error: unknown) => error instanceof ModerationError && error.code === "INVALID_BAN_DURATION"
  );
  await assert.rejects(
    executeTelegramActorModerationAction({
      chatId: "does-not-matter",
      targetTelegramUserId: 1,
      action: "BAN",
      reason: "test",
      banDurationMinutes: 0,
      telegramActor: { telegramUserId: 1 }
    }),
    (error: unknown) => error instanceof ModerationError && error.code === "INVALID_BAN_DURATION"
  );
});

test("moderation command metadata is explicit", () => {
  assert.equal(isModerationAction("WARNING"), true);
  assert.equal(isModerationAction("UNBAN"), true);
  assert.equal(isModerationAction("KICK"), true);
  assert.equal(isModerationAction("DELETE"), false);
  assert.equal(requiresReason("WARNING"), false);
  assert.equal(requiresReason("MUTE"), false);
  assert.equal(requiresReason("BAN"), false);
  assert.equal(requiresReason("KICK"), false);
  assert.equal(requiresReason("UNMUTE"), false);
  assert.equal(requiresReason("UNBAN"), false);
  assert.equal(isProtectedMemberStatus("CREATOR"), true);
  assert.equal(isProtectedMemberStatus("ADMINISTRATOR"), true);
  assert.equal(isProtectedMemberStatus("MEMBER"), false);
});

test("kick leaves no persistent punishment state, unlike ban", () => {
  const now = new Date("2026-08-18T10:00:00.000Z");
  const kicked = membershipUpdateFor("KICK", now);
  assert.equal(kicked.status, "LEFT");
  assert.equal(kicked.punishmentState, null);
  assert.equal(kicked.punishmentExpiresAt, null);
});

test("timed mute stores expiry and unmute clears it", () => {
  const now = new Date("2026-08-18T10:00:00.000Z");
  const expiresAt = new Date("2026-08-18T10:10:00.000Z");
  const muted = membershipUpdateFor("MUTE", now, expiresAt);
  assert.equal(muted.status, "RESTRICTED");
  assert.equal(muted.punishmentState, "MUTED");
  assert.equal(muted.punishmentExpiresAt?.toISOString(), expiresAt.toISOString());

  const unmuted = membershipUpdateFor("UNMUTE", now);
  assert.equal(unmuted.status, "MEMBER");
  assert.equal(unmuted.punishmentState, null);
  assert.equal(unmuted.punishmentExpiresAt, null);
});

test("timed ban stores expiry and unban clears it; permanent ban has no expiry", () => {
  const now = new Date("2026-08-18T10:00:00.000Z");
  const expiresAt = new Date("2026-08-25T10:00:00.000Z");
  const banned = membershipUpdateFor("BAN", now, expiresAt);
  assert.equal(banned.status, "BANNED");
  assert.equal(banned.punishmentState, "BANNED");
  assert.equal(banned.punishmentExpiresAt?.toISOString(), expiresAt.toISOString());

  const permanentBan = membershipUpdateFor("BAN", now);
  assert.equal(permanentBan.punishmentExpiresAt, null);

  const unbanned = membershipUpdateFor("UNBAN", now);
  assert.equal(unbanned.status, "LEFT");
  assert.equal(unbanned.punishmentState, null);
  assert.equal(unbanned.punishmentExpiresAt, null);
});

test("warning is persisted atomically without calling Telegram", async () => {
  const telegramChatId = -1009000000201n;
  const telegramUserId = 900000201n;
  const email = "moderation-warning-ci@example.com";

  await prisma.auditLog.deleteMany({ where: { actingAdmin: { email } } });
  await prisma.moderationAction.deleteMany({ where: { actingAdmin: { email } } });
  await prisma.adminUser.deleteMany({ where: { email } });
  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const admin = await prisma.adminUser.create({
    data: {
      email,
      displayName: "CI Moderator",
      passwordHash: "not-used-in-test",
      role: "MODERATOR"
    }
  });
  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "Moderation CI",
      type: "supergroup"
    }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId,
      firstName: "Warning",
      displayName: "Warning Target"
    }
  });
  const membership = await prisma.chatMember.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      status: "MEMBER"
    }
  });

  try {
    const result = await executeModerationAction({
      membershipId: membership.id,
      actingAdminId: admin.id,
      action: "WARNING",
      reason: "Повторная рекламная ссылка"
    });

    assert.equal(result.type, "WARNING");
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.warningCount, 1);

    const [savedMember, action, audit] = await Promise.all([
      prisma.chatMember.findUniqueOrThrow({ where: { id: membership.id } }),
      prisma.moderationAction.findFirstOrThrow({
        where: { affectedUserId: user.id, type: "WARNING" }
      }),
      prisma.auditLog.findFirstOrThrow({
        where: { affectedUserId: user.id, action: "MODERATION_WARNING" }
      })
    ]);

    assert.equal(savedMember.warningCount, 1);
    assert.equal(action.status, "SUCCEEDED");
    assert.equal(action.source, "ADMIN");
    assert.equal(action.reason, "Повторная рекламная ссылка");
    assert.equal(audit.actingAdminId, admin.id);
  } finally {
    await prisma.auditLog.deleteMany({ where: { actingAdminId: admin.id } });
    await prisma.moderationAction.deleteMany({ where: { actingAdminId: admin.id } });
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
    await prisma.adminUser.delete({ where: { id: admin.id } });
  }
});

test("Telegram-actor warning is persisted with source TELEGRAM and no admin", async () => {
  const telegramChatId = -1009000000301n;
  const telegramUserId = 900000301n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "In-chat command CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId, firstName: "Target", displayName: "Target User" }
  });
  const membership = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER" }
  });

  try {
    const result = await executeTelegramActorModerationAction({
      chatId: chat.id,
      targetTelegramUserId: Number(telegramUserId),
      action: "WARNING",
      reason: "Флуд ссылками",
      telegramActor: { telegramUserId: 555, username: "chat_admin", displayName: "Chat Admin" }
    });

    assert.equal(result.type, "WARNING");
    assert.equal(result.warningCount, 1);

    const action = await prisma.moderationAction.findFirstOrThrow({
      where: { affectedUserId: user.id, type: "WARNING" }
    });
    assert.equal(action.source, "TELEGRAM");
    assert.equal(action.actingAdminId, null);
    assert.equal((action.metadata as Record<string, unknown>).telegramActorId, 555);
    assert.equal((action.metadata as Record<string, unknown>).telegramActorUsername, "chat_admin");
  } finally {
    await prisma.moderationAction.deleteMany({ where: { affectedUserId: user.id } });
    await prisma.auditLog.deleteMany({ where: { affectedUserId: user.id } });
    await prisma.chatMember.deleteMany({ where: { id: membership.id } });
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});

test("Telegram-actor warning revoke decrements warningCount and rejects once it's zero", async () => {
  const telegramChatId = -1009000000303n;
  const telegramUserId = 900000303n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "Unwarn CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId, firstName: "Target", displayName: "Target User" }
  });
  const membership = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER", warningCount: 2, lastAutoEscalationWarningCount: 2 }
  });

  try {
    const revoked = await executeTelegramActorWarningRevoke({
      chatId: chat.id,
      targetTelegramUserId: Number(telegramUserId),
      telegramActor: { telegramUserId: 555, username: "chat_admin" }
    });
    assert.equal(revoked.warningCount, 1);
    assert.equal(revoked.chatId, chat.id);
    assert.equal(revoked.affectedUserId, user.id);

    const afterFirst = await prisma.chatMember.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(afterFirst.warningCount, 1);
    // Lowered so climbing back to the threshold escalates again.
    assert.equal(afterFirst.lastAutoEscalationWarningCount, 1);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { affectedUserId: user.id, action: "MODERATION_UNWARN" }
    });
    assert.equal(audit.source, "TELEGRAM");
    assert.equal(audit.actingAdminId, null);

    await executeTelegramActorWarningRevoke({
      chatId: chat.id,
      targetTelegramUserId: Number(telegramUserId),
      telegramActor: { telegramUserId: 555 }
    });
    const afterSecond = await prisma.chatMember.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(afterSecond.warningCount, 0);

    await assert.rejects(
      executeTelegramActorWarningRevoke({
        chatId: chat.id,
        targetTelegramUserId: Number(telegramUserId),
        telegramActor: { telegramUserId: 555 }
      }),
      (error: unknown) => error instanceof ModerationError && error.code === "NO_WARNINGS"
    );
  } finally {
    await prisma.moderationAction.deleteMany({ where: { affectedUserId: user.id } });
    await prisma.auditLog.deleteMany({ where: { affectedUserId: user.id } });
    await prisma.chatMember.deleteMany({ where: { id: membership.id } });
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});

test("Admin (Web Admin) warning revoke decrements warningCount, mirroring the Telegram-actor path", async () => {
  const telegramChatId = -1009000000304n;
  const telegramUserId = 900000304n;
  const email = "moderation-unwarn-admin-ci@example.com";

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });
  await prisma.adminUser.deleteMany({ where: { email } });

  const admin = await prisma.adminUser.create({
    data: { email, displayName: "CI Moderator", passwordHash: "not-used-in-test", role: "MODERATOR" }
  });
  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "Admin Unwarn CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: { telegramUserId, firstName: "Target", displayName: "Target User" }
  });
  const membership = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER", warningCount: 1, lastAutoEscalationWarningCount: 1 }
  });

  try {
    const revoked = await executeAdminWarningRevoke({ membershipId: membership.id, actingAdminId: admin.id });
    assert.equal(revoked.warningCount, 0);
    assert.equal(revoked.chatId, chat.id);
    assert.equal(revoked.affectedUserId, user.id);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { affectedUserId: user.id, action: "MODERATION_UNWARN" }
    });
    assert.equal(audit.source, "ADMIN");
    assert.equal(audit.actingAdminId, admin.id);

    await assert.rejects(
      executeAdminWarningRevoke({ membershipId: membership.id, actingAdminId: admin.id }),
      (error: unknown) => error instanceof ModerationError && error.code === "NO_WARNINGS"
    );
  } finally {
    await prisma.moderationAction.deleteMany({ where: { affectedUserId: user.id } });
    await prisma.auditLog.deleteMany({ where: { affectedUserId: user.id } });
    await prisma.chatMember.deleteMany({ where: { id: membership.id } });
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
    await prisma.adminUser.delete({ where: { id: admin.id } });
  }
});

test("Telegram-actor action accepts a missing reason and rejects an unknown member", async () => {
  const telegramChatId = -1009000000302n;
  await prisma.chat.deleteMany({ where: { telegramChatId } });
  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "In-chat command CI 2", type: "supergroup" }
  });

  try {
    // Reason is optional everywhere now -- a blank reason no longer throws
    // REASON_REQUIRED, it falls straight through to the normal member lookup
    // (and fails with MEMBER_NOT_FOUND here since this target doesn't exist).
    await assert.rejects(
      executeTelegramActorModerationAction({
        chatId: chat.id,
        targetTelegramUserId: 900000999,
        action: "WARNING",
        reason: "   ",
        telegramActor: { telegramUserId: 555 }
      }),
      (error: unknown) => error instanceof ModerationError && error.code === "MEMBER_NOT_FOUND"
    );

    await assert.rejects(
      executeTelegramActorModerationAction({
        chatId: chat.id,
        targetTelegramUserId: 900000999,
        action: "BAN",
        reason: "Спам",
        telegramActor: { telegramUserId: 555 }
      }),
      (error: unknown) => error instanceof ModerationError && error.code === "MEMBER_NOT_FOUND"
    );
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
  }
});