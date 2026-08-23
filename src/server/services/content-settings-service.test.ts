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

test("renderWelcomeTemplate substitutes all four documented placeholders", () => {
  const rendered = renderWelcomeTemplate("Привет, {name} ({username})! Чат «{group}», участников: {member_count}.", {
    name: "Аня",
    username: "@anya",
    group: "Тестовый чат",
    memberCount: "42"
  });
  assert.equal(rendered, "Привет, Аня (@anya)! Чат «Тестовый чат», участников: 42.");
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
