import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_REPORT_SETTINGS,
  normalizeReportSettings,
  resolveEffectiveReportSettings,
  updateChatReportSettings,
  updateGlobalReportProfile
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

test("a chat that never chose follows the global profile; opting out uses its own settings", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Report Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    await updateGlobalReportProfile({
      actingAdminId: admin.id,
      settings: { enabled: false, muteDurationMinutes: 30 }
    });

    const beforeAnyChatEdit = await resolveEffectiveReportSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "GLOBAL");
    assert.equal(beforeAnyChatEdit.settings.enabled, false);
    assert.equal(beforeAnyChatEdit.settings.muteDurationMinutes, 30);

    const saved = await updateChatReportSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      useGlobalProfile: false,
      settings: { enabled: true, muteDurationMinutes: 90 }
    });
    assert.equal(saved?.useGlobalProfile, false);

    const optedOut = await resolveEffectiveReportSettings(chat.id);
    assert.equal(optedOut.source, "CHAT");
    assert.equal(optedOut.settings.enabled, true);
    assert.equal(optedOut.settings.muteDurationMinutes, 90);
  } finally {
    await updateGlobalReportProfile({ actingAdminId: admin.id, settings: DEFAULT_REPORT_SETTINGS });
    await cleanup();
  }
});
