import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_MANUAL_MODERATION_SETTINGS,
  DEFAULT_MANUAL_MODERATION_VISIBILITY,
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
    unwarnMessageTemplate: "   ",
    muteMessageTemplate: "🔇 %target%",
    unmuteMessageTemplate: "🔊 %target%",
    muteDeleteTargetMessage: 1 as never
  });
  assert.equal(normalized.warnMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.warnMessageTemplate);
  assert.equal(normalized.unwarnMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.unwarnMessageTemplate);
  assert.equal(normalized.muteMessageTemplate, "🔇 %target%");
  assert.equal(normalized.unmuteMessageTemplate, "🔊 %target%");
  assert.equal(normalized.muteDeleteTargetMessage, true);
});

test("template rendering replaces every placeholder and tolerates repeats", () => {
  const text = renderManualModerationTemplate("%admin% -> %target%: %reason% (%duration%) %target%", {
    admin: "Admin",
    target: "@user",
    reason: "spam",
    duration: "10 мин.",
    warns: "",
    warnsLimit: ""
  });
  assert.equal(text, "Admin -> @user: spam (10 мин.) @user");
});

test("template rendering leaves empty placeholders blank rather than literal", () => {
  const text = renderManualModerationTemplate("%target% banned. %reason%", {
    admin: "Admin",
    target: "@user",
    reason: "",
    duration: "",
    warns: "",
    warnsLimit: ""
  });
  assert.equal(text, "@user banned. ");
});

test("%warns_limit% is replaced before %warns% so it isn't eaten as a prefix", () => {
  const text = renderManualModerationTemplate("%target%: %warns% из %warns_limit%", {
    admin: "Admin",
    target: "@user",
    reason: "",
    duration: "",
    warns: "3",
    warnsLimit: "3"
  });
  assert.equal(text, "@user: 3 из 3");
});

test("a chat that never chose follows the global profile; opting out uses its own templates", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Manual Moderation Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    // No ChatManualModerationSettings row yet — a chat that never made a choice
    // must follow the global profile, otherwise globally configured templates
    // would silently apply to no chat at all.
    const beforeAnyGlobalEdit = await resolveEffectiveManualModerationSettings(chat.id);
    assert.equal(beforeAnyGlobalEdit.source, "GLOBAL");
    assert.deepEqual(beforeAnyGlobalEdit.settings, DEFAULT_MANUAL_MODERATION_SETTINGS);

    await updateGlobalManualModerationProfile({
      actingAdminId: admin.id,
      settings: { ...DEFAULT_MANUAL_MODERATION_SETTINGS, banMessageTemplate: "GLOBAL BAN %target%" },
      visibility: DEFAULT_MANUAL_MODERATION_VISIBILITY
    });

    const stillFollowingGlobal = await resolveEffectiveManualModerationSettings(chat.id);
    assert.equal(stillFollowingGlobal.source, "GLOBAL");
    assert.equal(stillFollowingGlobal.settings.banMessageTemplate, "GLOBAL BAN %target%");

    const saved = await updateChatManualModerationProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      useGlobalProfile: false,
      settings: { ...DEFAULT_MANUAL_MODERATION_SETTINGS, banMessageTemplate: "CHAT BAN %target%" }
    });
    assert.equal(saved?.useGlobalProfile, false);

    const optedOut = await resolveEffectiveManualModerationSettings(chat.id);
    assert.equal(optedOut.source, "CHAT");
    assert.equal(optedOut.settings.banMessageTemplate, "CHAT BAN %target%");
  } finally {
    await updateGlobalManualModerationProfile({ actingAdminId: admin.id, settings: DEFAULT_MANUAL_MODERATION_SETTINGS, visibility: DEFAULT_MANUAL_MODERATION_VISIBILITY });
    await cleanup();
  }
});
