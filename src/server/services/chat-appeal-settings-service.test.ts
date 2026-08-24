import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_CHAT_APPEAL_SETTINGS,
  normalizeChatAppealSettings,
  resolveEffectiveChatAppealSettings,
  updateChatAppealProfile
} from "./chat-appeal-settings-service";

const CHAT_ID = -1009000016001n;
const ADMIN_EMAIL = "chat-appeal-settings-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("chat appeal settings are normalized: every flag coerced to boolean", () => {
  const normalized = normalizeChatAppealSettings({
    enabled: true,
    notifyAdminsOnSubmit: false,
    notifyUserOnDecision: true
  });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.notifyAdminsOnSubmit, false);
  assert.equal(normalized.notifyUserOnDecision, true);
});

test("a chat with no settings row defaults to fully-on (existing chats keep today's behavior); saved settings are read back from the chat's own row", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Appeal Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const beforeAnyChatEdit = await resolveEffectiveChatAppealSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "CHAT");
    assert.deepEqual(beforeAnyChatEdit.settings, DEFAULT_CHAT_APPEAL_SETTINGS);

    const saved = await updateChatAppealProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { enabled: false, notifyAdminsOnSubmit: false, notifyUserOnDecision: true }
    });
    assert.equal(saved?.enabled, false);
    assert.equal(saved?.notifyAdminsOnSubmit, false);

    const resolved = await resolveEffectiveChatAppealSettings(chat.id);
    assert.equal(resolved.settings.enabled, false);
    assert.equal(resolved.settings.notifyAdminsOnSubmit, false);
    assert.equal(resolved.settings.notifyUserOnDecision, true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { chatId: chat.id, action: "APPEAL_SETTINGS_UPDATED" }
    });
    assert.equal(audit.actingAdminId, admin.id);
  } finally {
    await cleanup();
  }
});

test("updateChatAppealProfile returns null for a nonexistent chat", async () => {
  const bogusId = "00000000-0000-4000-8000-000000000000";
  const saved = await updateChatAppealProfile({
    chatId: bogusId,
    actingAdminId: bogusId,
    settings: DEFAULT_CHAT_APPEAL_SETTINGS
  });
  assert.equal(saved, null);
});
