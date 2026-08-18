import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  executeModerationAction,
  isModerationAction,
  isProtectedMemberStatus,
  membershipUpdateFor,
  requiresReason
} from "./moderation-service";

test("moderation command metadata is explicit", () => {
  assert.equal(isModerationAction("WARNING"), true);
  assert.equal(isModerationAction("UNBAN"), true);
  assert.equal(isModerationAction("DELETE"), false);
  assert.equal(requiresReason("WARNING"), true);
  assert.equal(requiresReason("MUTE"), true);
  assert.equal(requiresReason("BAN"), true);
  assert.equal(requiresReason("UNMUTE"), false);
  assert.equal(requiresReason("UNBAN"), false);
  assert.equal(isProtectedMemberStatus("CREATOR"), true);
  assert.equal(isProtectedMemberStatus("ADMINISTRATOR"), true);
  assert.equal(isProtectedMemberStatus("MEMBER"), false);
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