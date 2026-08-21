import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  pendingActionMatchesTelegramState,
  reconcilePendingModerationActionLive,
  reconcileTelegramMemberState
} from "./moderation-reconciliation-service";

async function createFixture(suffix: number) {
  const chat = await prisma.chat.create({
    data: {
      telegramChatId: BigInt(-1009000000900 - suffix),
      title: `Reconciliation CI ${suffix}`,
      type: "supergroup"
    }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId: BigInt(9000000900 + suffix),
      firstName: "Reconcile",
      displayName: `Reconcile User ${suffix}`
    }
  });
  const member = await prisma.chatMember.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      status: "RESTRICTED",
      punishmentState: "MUTED",
      punishmentExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      lastModerationAt: new Date(Date.now() - 60 * 1000)
    }
  });
  const action = await prisma.moderationAction.create({
    data: {
      chatId: chat.id,
      affectedUserId: user.id,
      actingAdminId: null,
      source: "SYSTEM",
      type: "MUTE",
      status: "PENDING",
      reason: "Автоматический mute",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  return { chat, user, member, action };
}

async function cleanup(data: Awaited<ReturnType<typeof createFixture>>, adminId?: string) {
  await prisma.chat.delete({ where: { id: data.chat.id } });
  await prisma.telegramUser.delete({ where: { id: data.user.id } });
  if (adminId) await prisma.adminUser.delete({ where: { id: adminId } });
}

test("pending action matcher is conservative", () => {
  const member = {
    status: "member",
    user: { id: 100, is_bot: false, first_name: "CI" },
    can_send_messages: true
  };
  assert.equal(pendingActionMatchesTelegramState("MUTE", member), false);
  assert.equal(pendingActionMatchesTelegramState("BAN", member), false);
  assert.equal(pendingActionMatchesTelegramState("UNMUTE", member), true);
  assert.equal(pendingActionMatchesTelegramState("UNBAN", member), true);
  // Kick is ban-then-immediately-unban, so a finished kick looks like UNBAN on Telegram's side.
  assert.equal(pendingActionMatchesTelegramState("KICK", member), true);
});

test("Telegram restricted state confirms pending mute and later clears expired punishment", async () => {
  const data = await createFixture(1);
  try {
    const untilDate = Math.floor((Date.now() + 60 * 60 * 1000) / 1000);
    const restricted = await reconcileTelegramMemberState({
      chatId: data.chat.id,
      eventAt: new Date(),
      member: {
        status: "restricted",
        user: {
          id: Number(data.user.telegramUserId),
          is_bot: false,
          first_name: "Reconcile"
        },
        is_member: true,
        can_send_messages: false,
        until_date: untilDate
      }
    });

    assert.equal(restricted.reconciled, true);
    assert.equal(restricted.confirmedPending, 1);

    const confirmedAction = await prisma.moderationAction.findUniqueOrThrow({
      where: { id: data.action.id }
    });
    assert.equal(confirmedAction.status, "SUCCEEDED");
    assert.ok(confirmedAction.completedAt);

    const cleared = await reconcileTelegramMemberState({
      chatId: data.chat.id,
      eventAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      member: {
        status: "member",
        user: {
          id: Number(data.user.telegramUserId),
          is_bot: false,
          first_name: "Reconcile"
        },
        can_send_messages: true
      }
    });

    assert.equal(cleared.reconciled, true);
    assert.equal(cleared.stateChanged, true);

    const finalMember = await prisma.chatMember.findUniqueOrThrow({
      where: { id: data.member.id }
    });
    assert.equal(finalMember.status, "MEMBER");
    assert.equal(finalMember.punishmentState, null);
    assert.equal(finalMember.punishmentExpiresAt, null);

    const clearedAudit = await prisma.auditLog.findFirst({
      where: {
        chatId: data.chat.id,
        affectedUserId: data.user.id,
        action: "PUNISHMENT_STATE_CLEARED"
      }
    });
    assert.ok(clearedAudit);
  } finally {
    await cleanup(data);
  }
});

test("manual live reconciliation confirms a pending action from current Telegram state", async () => {
  const data = await createFixture(2);
  const admin = await prisma.adminUser.create({
    data: {
      email: "reconciliation-owner-ci@example.com",
      displayName: "Reconciliation Owner",
      passwordHash: "not-used-in-test",
      role: "OWNER"
    }
  });

  try {
    const result = await reconcilePendingModerationActionLive(
      { actionId: data.action.id, actingAdminId: admin.id },
      {
        readMember: async () => ({
          status: "restricted",
          user: {
            id: Number(data.user.telegramUserId),
            is_bot: false,
            first_name: "Reconcile"
          },
          is_member: true,
          can_send_messages: false,
          until_date: Math.floor((Date.now() + 30 * 60 * 1000) / 1000)
        })
      }
    );

    assert.equal(result.outcome, "confirmed");
    assert.equal(result.actionStatus, "SUCCEEDED");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        chatId: data.chat.id,
        affectedUserId: data.user.id,
        actingAdminId: admin.id,
        action: "MODERATION_RECONCILIATION_CHECKED"
      }
    });
    assert.match(audit.reason ?? "", /подтвердил/i);
  } finally {
    await cleanup(data, admin.id);
  }
});

test("manual live reconciliation leaves action pending when Telegram state does not confirm it", async () => {
  const data = await createFixture(3);
  const admin = await prisma.adminUser.create({
    data: {
      email: "reconciliation-admin-ci@example.com",
      displayName: "Reconciliation Admin",
      passwordHash: "not-used-in-test",
      role: "ADMIN"
    }
  });

  try {
    const result = await reconcilePendingModerationActionLive(
      { actionId: data.action.id, actingAdminId: admin.id },
      {
        readMember: async () => ({
          status: "member",
          user: {
            id: Number(data.user.telegramUserId),
            is_bot: false,
            first_name: "Reconcile"
          },
          can_send_messages: true
        })
      }
    );

    assert.equal(result.outcome, "not_confirmed");
    assert.equal(result.actionStatus, "PENDING");

    const action = await prisma.moderationAction.findUniqueOrThrow({
      where: { id: data.action.id }
    });
    assert.equal(action.status, "PENDING");
  } finally {
    await cleanup(data, admin.id);
  }
});