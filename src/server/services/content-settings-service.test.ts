import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_CONTENT_SETTINGS,
  normalizeContentSettings,
  renderWelcomeTemplate,
  resolveEffectiveContentSettings,
  updateChatContentSettings,
  updateGlobalContentProfile
} from "./content-settings-service";

const CHAT_ID = -1009000018001n;
const ADMIN_EMAIL = "content-settings-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("content settings are normalized: blank welcome template falls back to default, rules text is trimmed and capped", () => {
  const normalized = normalizeContentSettings({
    ...DEFAULT_CONTENT_SETTINGS,
    welcomeEnabled: true,
    welcomeMessageTemplate: "   ",
    rulesText: `  ${"a".repeat(4100)}  `
  });
  assert.equal(normalized.welcomeEnabled, true);
  assert.equal(normalized.welcomeMessageTemplate, DEFAULT_CONTENT_SETTINGS.welcomeMessageTemplate);
  assert.equal(normalized.rulesText.length, 4000);
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

test("a chat that never chose follows the global profile; opting out uses its own settings", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Content Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    await updateGlobalContentProfile({
      actingAdminId: admin.id,
      settings: { ...DEFAULT_CONTENT_SETTINGS, welcomeEnabled: true, rulesText: "Global rules" }
    });

    const beforeAnyChatEdit = await resolveEffectiveContentSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "GLOBAL");
    assert.equal(beforeAnyChatEdit.settings.welcomeEnabled, true);
    assert.equal(beforeAnyChatEdit.settings.rulesText, "Global rules");

    const saved = await updateChatContentSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      useGlobalProfile: false,
      settings: { ...DEFAULT_CONTENT_SETTINGS, welcomeEnabled: false, rulesText: "Chat-only rules" }
    });
    assert.equal(saved?.useGlobalProfile, false);

    const optedOut = await resolveEffectiveContentSettings(chat.id);
    assert.equal(optedOut.source, "CHAT");
    assert.equal(optedOut.settings.welcomeEnabled, false);
    assert.equal(optedOut.settings.rulesText, "Chat-only rules");
  } finally {
    await updateGlobalContentProfile({ actingAdminId: admin.id, settings: DEFAULT_CONTENT_SETTINGS });
    await cleanup();
  }
});
