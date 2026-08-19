import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_MANUAL_MODERATION_SETTINGS,
  normalizeManualModerationSettings,
  renderManualModerationTemplate,
  resolveEffectiveManualModerationSettings,
  updateChatManualModerationProfile,
  updateGlobalManualModerationProfile
} from "./manual-moderation-settings-service";

const CHAT_ID = -1009000013001n;
const ADMIN_EMAIL = "manual-moderation-settings-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("blank templates fall back to defaults, toggles are coerced to booleans", () => {
  const normalized = normalizeManualModerationSettings({
    ...DEFAULT_MANUAL_MODERATION_SETTINGS,
    warnMessageTemplate: "   ",
    muteMessageTemplate: "🔇 %target%",
    muteDeleteCommandMessage: 1 as never
  });
  assert.equal(normalized.warnMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.warnMessageTemplate);
  assert.equal(normalized.muteMessageTemplate, "🔇 %target%");
  assert.equal(normalized.muteDeleteCommandMessage, true);
});

test("template rendering replaces every placeholder and tolerates repeats", () => {
  const text = renderManualModerationTemplate("%admin% -> %target%: %reason% (%duration%) %target%", {
    admin: "Admin",
    target: "@user",
    reason: "spam",
    duration: "10 мин."
  });
  assert.equal(text, "Admin -> @user: spam (10 мин.) @user");
});

test("template rendering leaves empty placeholders blank rather than literal", () => {
  const text = renderManualModerationTemplate("%target% banned. %reason%", {
    admin: "Admin",
    target: "@user",
    reason: "",
    duration: ""
  });
  assert.equal(text, "@user banned. ");
});

test("chat defaults to its own templates and inherits the global profile once switched", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Manual Moderation Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const defaults = await resolveEffectiveManualModerationSettings(chat.id);
    assert.equal(defaults.source, "CHAT");
    assert.deepEqual(defaults.settings, DEFAULT_MANUAL_MODERATION_SETTINGS);

    await updateGlobalManualModerationProfile({
      actingAdminId: admin.id,
      settings: { ...DEFAULT_MANUAL_MODERATION_SETTINGS, banMessageTemplate: "GLOBAL BAN %target%" }
    });

    const saved = await updateChatManualModerationProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      useGlobalProfile: true,
      settings: { ...DEFAULT_MANUAL_MODERATION_SETTINGS, banMessageTemplate: "CHAT BAN %target%" }
    });
    assert.equal(saved?.useGlobalProfile, true);

    const effective = await resolveEffectiveManualModerationSettings(chat.id);
    assert.equal(effective.source, "GLOBAL");
    assert.equal(effective.settings.banMessageTemplate, "GLOBAL BAN %target%");
  } finally {
    await updateGlobalManualModerationProfile({ actingAdminId: admin.id, settings: DEFAULT_MANUAL_MODERATION_SETTINGS });
    await cleanup();
  }
});
