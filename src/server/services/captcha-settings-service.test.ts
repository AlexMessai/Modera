import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_CAPTCHA_SETTINGS,
  normalizeCaptchaSettings,
  resolveEffectiveCaptchaSettings,
  updateChatCaptchaProfile
} from "./captcha-settings-service";

const CHAT_ID = -1009000012001n;
const ADMIN_EMAIL = "captcha-settings-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("captcha settings are normalized: enabled coerced to boolean, blank template falls back to default", () => {
  const normalized = normalizeCaptchaSettings({
    ...DEFAULT_CAPTCHA_SETTINGS,
    enabled: true,
    challengeMessageTemplate: "   "
  });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.challengeMessageTemplate, DEFAULT_CAPTCHA_SETTINGS.challengeMessageTemplate);

  assert.equal(normalizeCaptchaSettings({ ...DEFAULT_CAPTCHA_SETTINGS, enabled: false }).enabled, false);
});

test("a chat with no settings row falls back to app defaults; saved settings are read back from the chat's own row", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Captcha Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const beforeAnyChatEdit = await resolveEffectiveCaptchaSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "CHAT");
    assert.equal(beforeAnyChatEdit.settings.enabled, DEFAULT_CAPTCHA_SETTINGS.enabled);

    const saved = await updateChatCaptchaProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { ...DEFAULT_CAPTCHA_SETTINGS, enabled: true }
    });
    assert.equal(saved?.enabled, true);

    const resolved = await resolveEffectiveCaptchaSettings(chat.id);
    assert.equal(resolved.source, "CHAT");
    assert.equal(resolved.settings.enabled, true);
  } finally {
    await cleanup();
  }
});
