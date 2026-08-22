import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_REPORT_SETTINGS,
  normalizeReportSettings,
  resolveEffectiveReportSettings,
  updateChatReportSettings
} from "./report-settings-service";

const CHAT_ID = -1009000017001n;
const ADMIN_EMAIL = "report-settings-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("report settings are normalized: enabled coerced to boolean, mute duration clamped to bounds", () => {
  const normalized = normalizeReportSettings({
    ...DEFAULT_REPORT_SETTINGS,
    enabled: true,
    muteDurationMinutes: 999999
  });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.muteDurationMinutes, 10080);

  assert.equal(normalizeReportSettings({ ...DEFAULT_REPORT_SETTINGS, enabled: false }).enabled, false);
  assert.equal(normalizeReportSettings({ ...DEFAULT_REPORT_SETTINGS, muteDurationMinutes: -5 }).muteDurationMinutes, 1);
});

test("a chat with no settings row falls back to app defaults; saved settings are read back from the chat's own row", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Report Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const beforeAnyChatEdit = await resolveEffectiveReportSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "CHAT");
    assert.equal(beforeAnyChatEdit.settings.enabled, DEFAULT_REPORT_SETTINGS.enabled);

    const saved = await updateChatReportSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { enabled: false, muteDurationMinutes: 90 }
    });
    assert.equal(saved?.enabled, false);
    assert.equal(saved?.muteDurationMinutes, 90);

    const resolved = await resolveEffectiveReportSettings(chat.id);
    assert.equal(resolved.source, "CHAT");
    assert.equal(resolved.settings.enabled, false);
    assert.equal(resolved.settings.muteDurationMinutes, 90);
  } finally {
    await cleanup();
  }
});
