import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { reconcileTelegramMemberState } from "./moderation-reconciliation-service";

async function createFixture() {
  const chat = await prisma.chat.create({
    data: {
      telegramChatId: -1009000000901n,
      title: "Reconciliation CI",
      type: "supergroup"
    }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId: 9000000901n,
      firstName: "Reconcile",
      displayName: "Reconcile User"
    }
  });
  const member = await prisma.chatMember.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      status: "RESTRICTED",
      punishmentState: "MUTED",
      punishmentExpiresAt: new Date("2026-08-18T15:00:00.000Z"),
      lastModerationAt: new Date("2026-08-18T10:00:00.000Z")
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
      expiresAt: new Date("2026-08-18T15:00:00.000Z")
    }
  });
  return { chat, user, member, action };
}

test("Telegram restricted state confirms pending mute and later clears expired punishment", async () => {
  const data = await createFixture();
  try {
    const restricted = await reconcileTelegramMemberState({
      chatId: data.chat.id,
      eventAt: new Date("2026-08-18T10:01:00.000Z"),
      member: {
        status: "restricted",
        user: {
          id: Number(data.user.telegramUserId),
          is_bot: false,
          first_name: "Reconcile"
        },
        is_member: true,
        can_send_messages: false,
        until_date: Math.floor(new Date("2026-08-18T15:00:00.000Z").getTime() / 1000)
      }
    });

    assert.equal(restricted.reconciled, true);
    assert.equal(restricted.confirmedPending, 1);

    const confirmedAction = await prisma.moderationAction.findUniqueOrThrow({
      where: { id: data.action.id }
    });
    assert.equal(confirmedAction.status, "SUCCEEDED");
    assert.ok(confirmedAction.completedAt);

    const mutedMember = await prisma.chatMember.findUniqueOrThrow({
      where: { id: data.member.id }
    });
    assert.equal(mutedMember.punishmentState, "MUTED");
    assert.equal(mutedMember.status, "RESTRICTED");
    assert.equal(mutedMember.punishmentExpiresAt?.toISOString(), "2026-08-18T15:00:00.000Z");

    const cleared = await reconcileTelegramMemberState({
      chatId: data.chat.id,
      eventAt: new Date("2026-08-18T15:01:00.000Z"),
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
    await prisma.chat.delete({ where: { id: data.chat.id } });
    await prisma.telegramUser.delete({ where: { id: data.user.id } });
  }
});
