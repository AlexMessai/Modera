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
  updateManualModerationVisibility
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

test("a chat with no settings row falls back to app defaults; saved templates are read back from the chat's own row", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Manual Moderation Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const beforeAnyEdit = await resolveEffectiveManualModerationSettings(chat.id);
    assert.equal(beforeAnyEdit.source, "CHAT");
    assert.deepEqual(beforeAnyEdit.settings, DEFAULT_MANUAL_MODERATION_SETTINGS);

    const saved = await updateChatManualModerationProfile({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { ...DEFAULT_MANUAL_MODERATION_SETTINGS, banMessageTemplate: "CHAT BAN %target%" }
    });
    assert.equal(saved?.banMessageTemplate, "CHAT BAN %target%");

    const resolved = await resolveEffectiveManualModerationSettings(chat.id);
    assert.equal(resolved.source, "CHAT");
    assert.equal(resolved.settings.banMessageTemplate, "CHAT BAN %target%");
  } finally {
    await cleanup();
  }
});

test("updateManualModerationVisibility only touches the visibility flags on the global row", async () => {
  await cleanup();
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const saved = await updateManualModerationVisibility({
      actingAdminId: admin.id,
      visibility: { ...DEFAULT_MANUAL_MODERATION_VISIBILITY, publicPunishmentMessagesEnabled: false }
    });
    assert.equal(saved.publicPunishmentMessagesEnabled, false);
    assert.equal(saved.privatePunishmentMessagesEnabled, DEFAULT_MANUAL_MODERATION_VISIBILITY.privatePunishmentMessagesEnabled);
  } finally {
    await updateManualModerationVisibility({ actingAdminId: admin.id, visibility: DEFAULT_MANUAL_MODERATION_VISIBILITY });
    await cleanup();
  }
});
