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
          escalationRules: [
            { order: 1, thresholdWarnings: 5, action: "MUTE", durationMinutes: 10 },
            { order: 2, thresholdWarnings: 8, action: "BAN", durationMinutes: null }
          ]
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

test("revoked warning records never count as active, with or without expiry", async () => {
  const data = await fixture(14);
  const now = new Date();
  const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  try {
    await prisma.chatMember.update({
      where: { id: data.member.id },
      data: { warningCount: 2 }
    });
    await prisma.moderationAction.createMany({
      data: [
        {
          chatId: data.chat.id,
          affectedUserId: data.user.id,
          source: "ADMIN",
          type: "WARNING",
          status: "SUCCEEDED",
          completedAt: old,
          createdAt: old
        },
        {
          chatId: data.chat.id,
          affectedUserId: data.user.id,
          source: "ADMIN",
          type: "WARNING",
          status: "SUCCEEDED",
          completedAt: recent,
          createdAt: recent
        },
        {
          chatId: data.chat.id,
          affectedUserId: data.user.id,
          source: "ADMIN",
          type: "WARNING",
          status: "SUCCEEDED",
          completedAt: now,
          revokedAt: now,
          revocationReason: "CI revoke"
        }
      ]
    });

    assert.equal(
      await countActiveWarnings({
        chatId: data.chat.id,
        affectedUserId: data.user.id,
        warningExpiryDays: 0,
        now
      }),
      2
    );
    assert.equal(
      await countActiveWarnings({
        chatId: data.chat.id,
        affectedUserId: data.user.id,
        warningExpiryDays: 30,
        now
      }),
      1
    );
  } finally {
    await prisma.chat.delete({ where: { id: data.chat.id } });
    await prisma.telegramUser.delete({ where: { id: data.user.id } });
  }
});

test("manual /warn shares automod's threshold: below it nothing is attempted, the 3rd warning tries to mute", async () => {
  const data = await fixture(4);
  try {
    await prisma.chatModerationSettings.update({
      where: { chatId: data.chat.id },
      data: {
        escalationRules: [
          { order: 1, thresholdWarnings: 3, action: "MUTE", durationMinutes: 4320 },
          { order: 2, thresholdWarnings: 8, action: "BAN", durationMinutes: null }
        ]
      }
    });

    for (let i = 1; i <= 2; i += 1) {
      const warning = await executeTelegramActorModerationAction({
        chatId: data.chat.id,
        targetTelegramUserId: Number(data.user.telegramUserId),
        action: "WARNING",
        reason: `Нарушение ${i}`,
        telegramActor: { telegramUserId: 555, username: "chat_admin" }
      });
      assert.equal(warning.warningCount, i);
      const below = await escalateAfterManualWarning({
        chatId: data.chat.id,
        targetTelegramUserId: Number(data.user.telegramUserId),
        reason: `Нарушение ${i}`
      });
      assert.equal(below.activeWarningCount, i);
      assert.equal(below.escalated, false);
      assert.equal(below.action, undefined);
    }

    const thirdWarning = await executeTelegramActorModerationAction({
      chatId: data.chat.id,
      targetTelegramUserId: Number(data.user.telegramUserId),
      action: "WARNING",
      reason: "Нарушение 3",
      telegramActor: { telegramUserId: 555, username: "chat_admin" }
    });
    assert.equal(thirdWarning.warningCount, 3);

    // No TELEGRAM_BOT_TOKEN in CI (see CLAUDE.md), so the mute this threshold
    // triggers can't actually reach Telegram — attemptedAction/error surface
    // that as "threshold reached but the punishment itself failed", distinct
    // from "threshold not reached" (escalated: false in both cases, so this
    // is the only way the admin's chat reply can tell them apart).
    const escalation = await escalateAfterManualWarning({
      chatId: data.chat.id,
      targetTelegramUserId: Number(data.user.telegramUserId),
      reason: "Нарушение 3"
    });
    assert.equal(escalation.escalated, false);
    assert.equal(escalation.action, undefined);
    assert.equal(escalation.attemptedAction, "MUTE");
    assert.ok(escalation.error);

    // The failed attempt must not leave the escalation marker claimed, so a
    // retry (e.g. once a real bot token is configured) can escalate again.
    const member = await prisma.chatMember.findUniqueOrThrow({ where: { id: data.member.id } });
    assert.equal(member.lastAutoEscalationWarningCount, 0);
    assert.equal(member.punishmentState, null);

    const standing = await describeWarningStanding({ chatId: data.chat.id, affectedUserId: data.user.id });
    assert.equal(standing.activeWarningCount, 3);
    assert.equal(standing.warnsLimit, 3);

    // The failure was already recorded to AuditLog (Журнал) by
    // executeTelegramBackedAction's own failAction() -- escalateAfterManualWarning
    // just needed to stop discarding attemptedAction/error on the way out.
    const failureLog = await prisma.auditLog.findFirst({
      where: { chatId: data.chat.id, affectedUserId: data.user.id, action: "AUTOMOD_ESCALATION_FAILED" },
      orderBy: { createdAt: "desc" }
    });
    assert.ok(failureLog);
    assert.equal((failureLog!.metadata as { type?: string })?.type, "MUTE");
  } finally {
    await prisma.moderationAction.deleteMany({ where: { chatId: data.chat.id } });
    await prisma.auditLog.deleteMany({ where: { chatId: data.chat.id } });
    await prisma.chat.delete({ where: { id: data.chat.id } });
    await prisma.telegramUser.delete({ where: { id: data.user.id } });
  }
});

test("a warning with no escalation rules configured logs a diagnostic entry instead of failing silently", async () => {
  const telegramChatId = -1009000000403n;
  const telegramUserId = 900000403n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "Escalation CI no-rules",
      type: "supergroup",
      moderationSettings: { create: { autoEscalationEnabled: true, escalationRules: [] } }
    }
  });
  const user = await prisma.telegramUser.create({ data: { telegramUserId, firstName: "CI", displayName: "CI No Rules" } });
  await prisma.chatMember.create({ data: { chatId: chat.id, userId: user.id, status: "MEMBER" } });

  try {
    await executeTelegramActorModerationAction({
      chatId: chat.id,
      targetTelegramUserId: Number(telegramUserId),
      action: "WARNING",
      reason: "Test",
      telegramActor: { telegramUserId: 555, username: "chat_admin" }
    });
    const escalation = await escalateAfterManualWarning({
      chatId: chat.id,
      targetTelegramUserId: Number(telegramUserId),
      reason: "Test"
    });
    assert.equal(escalation.escalated, false);
    assert.equal(escalation.warnsLimit, null);

    const diagnostic = await prisma.auditLog.findFirst({
      where: { chatId: chat.id, affectedUserId: user.id, action: "AUTOMOD_ESCALATION_NOT_TRIGGERED" }
    });
    assert.ok(diagnostic);
    assert.equal(diagnostic!.reason, "Нет настроенных правил порога.");
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
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
