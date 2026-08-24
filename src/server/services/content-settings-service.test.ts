import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_CONTENT_SETTINGS,
  normalizeContentSettings,
  renderWelcomeTemplate,
  resolveEffectiveContentSettings,
  updateChatContentSettings
} from "./content-settings-service";
import { newMemberBlockReason } from "./new-member-protection-service";

const CHAT_ID = -1009000018001n;
const ADMIN_EMAIL = "content-settings-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("content settings are normalized: blank welcome template falls back to default", () => {
  const normalized = normalizeContentSettings({
    ...DEFAULT_CONTENT_SETTINGS,
    welcomeEnabled: true,
    welcomeMessageTemplate: "   "
  });
  assert.equal(normalized.welcomeEnabled, true);
  assert.equal(normalized.welcomeMessageTemplate, DEFAULT_CONTENT_SETTINGS.welcomeMessageTemplate);
});

test("content settings normalize buttons and advanced join protection bounds", () => {
  const normalized = normalizeContentSettings({
    ...DEFAULT_CONTENT_SETTINGS,
    welcomeButtons: [{ text: "  Правила  ", url: "https://example.com/rules" }, { text: "bad", url: "javascript:alert(1)" }],
    muteNewMembersMinutes: 99999,
    maxNameLength: -5,
    blockedNamePatterns: [" casino ", "", "r:[0-9]+"]
  });
  assert.deepEqual(normalized.welcomeButtons, [{ text: "Правила", url: "https://example.com/rules" }]);
  assert.equal(normalized.muteNewMembersMinutes, 10080);
  assert.equal(normalized.maxNameLength, 0);
  assert.deepEqual(normalized.blockedNamePatterns, ["casino", "r:[0-9]+"]);
});

test("renderWelcomeTemplate substitutes all four documented placeholders", () => {
  const rendered = renderWelcomeTemplate("Привет, {name} ({username})! Чат «{group}», участников: {member_count}.", {
    name: "Аня",
    username: "@anya",
    group: "Тестовый чат",
    memberCount: "42"
  });
  assert.equal(rendered, "Привет, Аня (@anya)! Чат «Тестовый чат», участников: 42.");
});

test("advanced member protection detects each configured name rule", () => {
  assert.equal(newMemberBlockReason({ ...DEFAULT_CONTENT_SETTINGS, blockRtlNames: true }, { id: 1, is_bot: false, first_name: "שלום" }), "RTL_NAME");
  assert.equal(newMemberBlockReason({ ...DEFAULT_CONTENT_SETTINGS, blockMissingUsername: true }, { id: 2, is_bot: false, first_name: "Без username" }), "MISSING_USERNAME");
  assert.equal(newMemberBlockReason({ ...DEFAULT_CONTENT_SETTINGS, maxNameLength: 4 }, { id: 3, is_bot: false, first_name: "Длинное" }), "NAME_TOO_LONG");
  assert.equal(newMemberBlockReason({ ...DEFAULT_CONTENT_SETTINGS, blockedNamePatterns: ["r:[0-9]+"] }, { id: 4, is_bot: false, first_name: "User123" }), "BLOCKED_NAME_PATTERN");
  assert.equal(newMemberBlockReason({ ...DEFAULT_CONTENT_SETTINGS, blockChatFolderJoins: true }, { id: 5, is_bot: false, first_name: "Folder", username: "folder" }, true), "CHAT_FOLDER_JOIN");
  assert.equal(newMemberBlockReason({ ...DEFAULT_CONTENT_SETTINGS, blockInvitedBots: true }, { id: 6, is_bot: true, first_name: "Bot" }), "INVITED_BOT");
});

test("a chat with no settings row falls back to app defaults; saved settings are read back from the chat's own row", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Content Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const beforeAnyChatEdit = await resolveEffectiveContentSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "CHAT");
    assert.equal(beforeAnyChatEdit.settings.welcomeEnabled, DEFAULT_CONTENT_SETTINGS.welcomeEnabled);

    const saved = await updateChatContentSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { ...DEFAULT_CONTENT_SETTINGS, welcomeEnabled: true }
    });
    assert.equal(saved?.welcomeEnabled, true);

    const resolved = await resolveEffectiveContentSettings(chat.id);
    assert.equal(resolved.source, "CHAT");
    assert.equal(resolved.settings.welcomeEnabled, true);
  } finally {
    await cleanup();
  }
});
