import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_CAPTCHA_SETTINGS,
  normalizeCaptchaSettings,
  resolveEffectiveCaptchaSettings,
  updateChatCaptchaProfile,
  updateGlobalCaptchaProfile
} from "./captcha-settings-service";

const CHAT_ID = -1009000012001n;
const ADMIN_EMAIL = "captcha-settings-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("captcha settings are normalized and bounded", () => {
  const normalized = normalizeCaptchaSettings({
    enabled: true,
    timeoutMinutes: 5000,
    failAction: "INVALID" as never
  });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.timeoutMinutes, 1440);
  assert.equal(normalized.failAction, "KICK");
});

test("a chat that never chose follows the global profile; opting out uses its own settings", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Captcha Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    // No ChatCaptchaSettings row yet — a chat that never made a choice must
    // follow the global profile, otherwise a protective global policy would
    // silently apply to no chat at all.
    await updateGlobalCaptchaProfile({
      actingAdminId: admin.id,
      settings: { enabled: true, timeoutMinutes: 15, failAction: "BAN" }
    });

    const beforeAnyChatEdit = await resolveEffectiveCaptchaSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "GLOBAL");
    assert.equal(beforeAnyChatEdit.settings.enabled, true);
    assert.equal(beforeAnyChatEdit.settings.timeoutMinutes, 15);
    assert.equal(beforeAnyChatEdit.settings.failAction, "BAN");

    const saved = await updateChatCaptchaProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      useGlobalProfile: false,
      settings: { enabled: false, timeoutMinutes: 5, failAction: "KICK" }
    });
    assert.equal(saved?.useGlobalProfile, false);

    const optedOut = await resolveEffectiveCaptchaSettings(chat.id);
    assert.equal(optedOut.source, "CHAT");
    assert.equal(optedOut.settings.enabled, false);
  } finally {
    await updateGlobalCaptchaProfile({ actingAdminId: admin.id, settings: DEFAULT_CAPTCHA_SETTINGS });
    await cleanup();
  }
});
