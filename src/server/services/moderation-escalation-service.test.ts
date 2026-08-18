import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { recordAutomodViolationAndEscalate } from "./moderation-escalation-service";

async function fixture(suffix: number, status: "MEMBER" | "ADMINISTRATOR" = "MEMBER") {
  const chat = await prisma.chat.create({
    data: {
      telegramChatId: BigInt(-1009000000800 - suffix),
      title: `Escalation CI ${suffix}`,
      type: "supergroup",
      moderationSettings: {
        create: {
          autoEscalationEnabled: true,
          muteAfterWarnings: 5,
          muteDurationMinutes: 10,
          banAfterWarnings: 8
        }
      }
    }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId: BigInt(9000000800 + suffix),
      firstName: "CI",
      displayName: `CI User ${suffix}`
    }
  });
  const member = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status }
  });
  return { chat, user, member };
}

test("automod violation creates one system warning below punishment threshold", async () => {
  const data = await fixture(1);
  try {
    const result = await recordAutomodViolationAndEscalate({
      chatId: data.chat.id,
      telegramUserId: Number(data.user.telegramUserId),
      rule: "LINK",
      telegramMessageId: "501"
    });
    assert.equal(result.enabled, true);
    assert.equal(result.escalated, false);

    const member = await prisma.chatMember.findUniqueOrThrow({ where: { id: data.member.id } });
    assert.equal(member.warningCount, 1);
    assert.equal(member.lastAutoEscalationWarningCount, 0);
    assert.equal(member.punishmentState, null);

    const action = await prisma.moderationAction.findFirstOrThrow({
      where: { chatId: data.chat.id, affectedUserId: data.user.id, type: "WARNING" }
    });
    assert.equal(action.source, "SYSTEM");
    assert.equal(action.actingAdminId, null);
    assert.equal(action.status, "SUCCEEDED");
  } finally {
    await prisma.chat.delete({ where: { id: data.chat.id } });
    await prisma.telegramUser.delete({ where: { id: data.user.id } });
  }
});

test("automatic punishment escalation skips protected Telegram administrators", async () => {
  const data = await fixture(2, "ADMINISTRATOR");
  try {
    const result = await recordAutomodViolationAndEscalate({
      chatId: data.chat.id,
      telegramUserId: Number(data.user.telegramUserId),
      rule: "SPAM",
      telegramMessageId: "502"
    });
    assert.equal(result.enabled, true);
    assert.equal(result.escalated, false);

    const member = await prisma.chatMember.findUniqueOrThrow({ where: { id: data.member.id } });
    assert.equal(member.warningCount, 0);
    const actionCount = await prisma.moderationAction.count({ where: { chatId: data.chat.id } });
    assert.equal(actionCount, 0);
    const skip = await prisma.auditLog.findFirst({
      where: { chatId: data.chat.id, action: "AUTOMOD_ESCALATION_SKIPPED_PROTECTED" }
    });
    assert.ok(skip);
  } finally {
    await prisma.chat.delete({ where: { id: data.chat.id } });
    await prisma.telegramUser.delete({ where: { id: data.user.id } });
  }
});