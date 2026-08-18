import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { listModerationJournal } from "./journal-service";

test("journal separates manual automod errors and pending actions", async () => {
  const telegramChatId = -1009000000601n;
  const telegramUserId = 900000601n;
  const adminEmail = "journal-ci@example.test";

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { chat: { telegramChatId } },
        { affectedUser: { telegramUserId } },
        { actingAdmin: { email: adminEmail } }
      ]
    }
  });
  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });
  await prisma.adminUser.deleteMany({ where: { email: adminEmail } });

  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "Journal CI Chat",
      type: "supergroup"
    }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId,
      username: "journal_target",
      firstName: "Journal",
      displayName: "Journal Target"
    }
  });
  const admin = await prisma.adminUser.create({
    data: {
      email: adminEmail,
      displayName: "Journal Admin",
      passwordHash: "ci-only",
      role: "ADMIN"
    }
  });

  try {
    await prisma.auditLog.createMany({
      data: [
        {
          chatId: chat.id,
          affectedUserId: user.id,
          actingAdminId: admin.id,
          source: "ADMIN",
          action: "MODERATION_BAN",
          reason: "Journal manual event"
        },
        {
          chatId: chat.id,
          affectedUserId: user.id,
          source: "SYSTEM",
          action: "AUTOMOD_LINK_DELETED",
          reason: "Journal automod event"
        },
        {
          chatId: chat.id,
          affectedUserId: user.id,
          source: "SYSTEM",
          action: "AUTOMOD_DELETE_FAILED",
          reason: "Journal failure event"
        }
      ]
    });

    const pendingAction = await prisma.moderationAction.create({
      data: {
        chatId: chat.id,
        affectedUserId: user.id,
        actingAdminId: admin.id,
        type: "MUTE",
        status: "PENDING",
        reason: "Journal pending event"
      }
    });

    const all = await listModerationJournal({
      page: 1,
      pageSize: 50,
      category: "ALL",
      chatId: chat.id
    });
    assert.equal(all.pagination.total, 3);
    assert.equal(all.items.length, 3);
    assert.deepEqual(
      new Set(all.items.map((item) => item.action)),
      new Set(["MODERATION_BAN", "AUTOMOD_LINK_DELETED", "AUTOMOD_DELETE_FAILED"])
    );
    assert.deepEqual(all.pending.map((item) => item.id), [pendingAction.id]);

    const manual = await listModerationJournal({
      page: 1,
      pageSize: 50,
      category: "MANUAL",
      chatId: chat.id
    });
    assert.equal(manual.pagination.total, 1);
    assert.equal(manual.items[0]?.action, "MODERATION_BAN");
    assert.equal(manual.pending.length, 1);

    const automod = await listModerationJournal({
      page: 1,
      pageSize: 50,
      category: "AUTOMOD",
      chatId: chat.id
    });
    assert.equal(automod.pagination.total, 2);
    assert.equal(automod.pending.length, 0);

    const errors = await listModerationJournal({
      page: 1,
      pageSize: 50,
      category: "ERRORS",
      chatId: chat.id
    });
    assert.equal(errors.pagination.total, 1);
    assert.equal(errors.items[0]?.action, "AUTOMOD_DELETE_FAILED");
    assert.equal(errors.items[0]?.status, "FAILED");

    const pending = await listModerationJournal({
      page: 1,
      pageSize: 50,
      category: "PENDING",
      chatId: chat.id
    });
    assert.equal(pending.pagination.total, 0);
    assert.equal(pending.items.length, 0);
    assert.deepEqual(pending.pending.map((item) => item.id), [pendingAction.id]);

    const searched = await listModerationJournal({
      page: 1,
      pageSize: 50,
      category: "ALL",
      chatId: chat.id,
      search: "journal_target"
    });
    assert.equal(searched.pagination.total, 3);
    assert.equal(searched.pending.length, 1);
  } finally {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { chatId: chat.id },
          { affectedUserId: user.id },
          { actingAdminId: admin.id }
        ]
      }
    });
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.adminUser.delete({ where: { id: admin.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});
