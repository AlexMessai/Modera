import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  isTrustedTelegramMember,
  setTrustedMember,
  TRUSTED_INTERNAL_ROLE
} from "./trusted-member-service";

const CHAT_ID = -1009000012001n;
const USER_ID = 9000012001n;
const EMAIL = "trusted-member-ci@example.com";

test("trusted membership is scoped to one chat and audited", async () => {
  await prisma.adminUser.deleteMany({ where: { email: EMAIL } });
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: USER_ID } });

  const admin = await prisma.adminUser.create({
    data: {
      email: EMAIL,
      displayName: "Trusted CI Admin",
      passwordHash: "not-used-in-test",
      role: "ADMIN"
    }
  });
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Trusted CI", type: "supergroup" }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId: USER_ID,
      firstName: "Trusted",
      displayName: "Trusted User"
    }
  });
  const membership = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: user.id, status: "MEMBER" }
  });

  try {
    assert.equal(await isTrustedTelegramMember(chat.id, Number(USER_ID)), false);

    const added = await setTrustedMember({
      membershipId: membership.id,
      actingAdminId: admin.id,
      trusted: true
    });
    assert.ok(added && !("error" in added));
    assert.equal(added.trusted, true);
    assert.equal(await isTrustedTelegramMember(chat.id, Number(USER_ID)), true);

    const saved = await prisma.chatMember.findUniqueOrThrow({ where: { id: membership.id } });
    assert.equal(saved.internalRole, TRUSTED_INTERNAL_ROLE);

    const addAudit = await prisma.auditLog.findFirst({
      where: {
        chatId: chat.id,
        affectedUserId: user.id,
        actingAdminId: admin.id,
        action: "TRUSTED_MEMBER_ADDED"
      }
    });
    assert.ok(addAudit);

    const repeated = await setTrustedMember({
      membershipId: membership.id,
      actingAdminId: admin.id,
      trusted: true
    });
    assert.ok(repeated && !("error" in repeated));
    assert.equal(repeated.changed, false);
    assert.equal(await prisma.auditLog.count({ where: { chatId: chat.id, action: "TRUSTED_MEMBER_ADDED" } }), 1);

    const removed = await setTrustedMember({
      membershipId: membership.id,
      actingAdminId: admin.id,
      trusted: false
    });
    assert.ok(removed && !("error" in removed));
    assert.equal(removed.trusted, false);
    assert.equal(await isTrustedTelegramMember(chat.id, Number(USER_ID)), false);

    const removeAudit = await prisma.auditLog.findFirst({
      where: {
        chatId: chat.id,
        affectedUserId: user.id,
        actingAdminId: admin.id,
        action: "TRUSTED_MEMBER_REMOVED"
      }
    });
    assert.ok(removeAudit);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
    await prisma.adminUser.delete({ where: { id: admin.id } });
  }
});