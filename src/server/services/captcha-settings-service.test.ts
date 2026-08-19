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

test("chat defaults to disabled captcha and inherits the global profile once switched", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Captcha Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const defaults = await resolveEffectiveCaptchaSettings(chat.id);
    assert.equal(defaults.source, "CHAT");
    assert.deepEqual(defaults.settings, DEFAULT_CAPTCHA_SETTINGS);

    await updateGlobalCaptchaProfile({
      actingAdminId: admin.id,
      settings: { enabled: true, timeoutMinutes: 15, failAction: "BAN" }
    });

    const saved = await updateChatCaptchaProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      useGlobalProfile: true,
      settings: { enabled: false, timeoutMinutes: 5, failAction: "KICK" }
    });
    assert.equal(saved?.useGlobalProfile, true);

    const effective = await resolveEffectiveCaptchaSettings(chat.id);
    assert.equal(effective.source, "GLOBAL");
    assert.equal(effective.settings.enabled, true);
    assert.equal(effective.settings.timeoutMinutes, 15);
    assert.equal(effective.settings.failAction, "BAN");
  } finally {
    await updateGlobalCaptchaProfile({ actingAdminId: admin.id, settings: DEFAULT_CAPTCHA_SETTINGS });
    await cleanup();
  }
});
