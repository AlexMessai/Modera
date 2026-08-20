import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  countActiveWarnings,
  describeWarningStanding,
  escalateAfterManualWarning,
  recordAutomodViolationAndEscalate,
  warningCutoff
} from "./moderation-escalation-service";
import { executeTelegramActorModerationAction } from "./moderation-service";

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
    assert.equal(result.activeWarningCount, 1);

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

test("warning expiry keeps history but excludes old warnings from escalation", async () => {
  const data = await fixture(3);
  const now = new Date();
  const days = (value: number) => new Date(now.getTime() - value * 24 * 60 * 60 * 1000);

  try {
    await prisma.chatModerationSettings.update({
      where: { chatId: data.chat.id },
      data: { warningExpiryDays: 30 }
    });
    await prisma.chatMember.update({
      where: { id: data.member.id },
      data: { warningCount: 3 }
    });

    await prisma.moderationAction.createMany({
      data: [
        {
          chatId: data.chat.id,
          affectedUserId: data.user.id,
          source: "SYSTEM",
          type: "WARNING",
          status: "SUCCEEDED",
          reason: "Старое предупреждение",
          completedAt: days(60),
          createdAt: days(60)
        },
        {
          chatId: data.chat.id,
          affectedUserId: data.user.id,
          source: "ADMIN",
          type: "WARNING",
          status: "SUCCEEDED",
          reason: "Недавнее ручное предупреждение",
          completedAt: days(10),
          createdAt: days(10)
        },
        {
          chatId: data.chat.id,
          affectedUserId: data.user.id,
          source: "SYSTEM",
          type: "WARNING",
          status: "SUCCEEDED",
          reason: "Недавнее автоматическое предупреждение",
          completedAt: days(1),
          createdAt: days(1)
        }
      ]
    });

    assert.equal(
      await countActiveWarnings({
        chatId: data.chat.id,
        affectedUserId: data.user.id,
        warningExpiryDays: 30,
        now
      }),
      2
    );
    assert.equal(
      await countActiveWarnings({
        chatId: data.chat.id,
        affectedUserId: data.user.id,
        warningExpiryDays: 0,
        now
      }),
      3
    );

    const result = await recordAutomodViolationAndEscalate({
      chatId: data.chat.id,
      telegramUserId: Number(data.user.telegramUserId),
      rule: "TERM",
      telegramMessageId: "503"
    });

    assert.equal(result.enabled, true);
    assert.equal(result.escalated, false);
    assert.equal(result.warningCount, 4);
    assert.equal(result.activeWarningCount, 3);

    const member = await prisma.chatMember.findUniqueOrThrow({ where: { id: data.member.id } });
    assert.equal(member.warningCount, 4);
    assert.equal(member.lastAutoEscalationWarningCount, 0);

    const latest = await prisma.moderationAction.findFirstOrThrow({
      where: {
        chatId: data.chat.id,
        affectedUserId: data.user.id,
        type: "WARNING",
        reason: { contains: "Автомодерация" }
      },
      orderBy: { createdAt: "desc" }
    });
    const metadata = latest.metadata as Record<string, unknown> | null;
    assert.equal(metadata?.activeWarningCount, 3);
    assert.equal(metadata?.warningExpiryDays, 30);
  } finally {
    await prisma.chat.delete({ where: { id: data.chat.id } });
    await prisma.telegramUser.delete({ where: { id: data.user.id } });
  }
});

test("manual /warn shares automod's threshold: the 3rd warning mutes the member", async () => {
  const data = await fixture(4);
  try {
    await prisma.chatModerationSettings.update({
      where: { chatId: data.chat.id },
      data: { muteAfterWarnings: 3, muteDurationMinutes: 4320, banAfterWarnings: 8 }
    });

    let last: Awaited<ReturnType<typeof escalateAfterManualWarning>> | null = null;
    for (let i = 1; i <= 3; i += 1) {
      const warning = await executeTelegramActorModerationAction({
        chatId: data.chat.id,
        targetTelegramUserId: Number(data.user.telegramUserId),
        action: "WARNING",
        reason: `Нарушение ${i}`,
        telegramActor: { telegramUserId: 555, username: "chat_admin" }
      });
      assert.equal(warning.warningCount, i);
      last = await escalateAfterManualWarning({
        membershipId: data.member.id,
        chatId: data.chat.id,
        affectedUserId: data.user.id,
        reason: `Нарушение ${i}`,
        warningCount: warning.warningCount
      });
    }

    assert.equal(last?.activeWarningCount, 3);
    assert.equal(last?.warnsLimit, 3);
    assert.equal(last?.escalated, true);
    assert.equal(last?.action, "MUTE");
    assert.equal(last?.muteDurationMinutes, 4320);

    const member = await prisma.chatMember.findUniqueOrThrow({ where: { id: data.member.id } });
    assert.equal(member.punishmentState, "MUTED");

    const standing = await describeWarningStanding({ chatId: data.chat.id, affectedUserId: data.user.id });
    assert.equal(standing.activeWarningCount, 3);
    assert.equal(standing.warnsLimit, 3);
  } finally {
    await prisma.moderationAction.deleteMany({ where: { chatId: data.chat.id } });
    await prisma.auditLog.deleteMany({ where: { chatId: data.chat.id } });
    await prisma.chat.delete({ where: { id: data.chat.id } });
    await prisma.telegramUser.delete({ where: { id: data.user.id } });
  }
});

test("warning cutoff is disabled at zero and stable for positive days", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  assert.equal(warningCutoff(now, 0), null);
  assert.equal(
    warningCutoff(now, 30)?.toISOString(),
    "2026-07-19T12:00:00.000Z"
  );
});