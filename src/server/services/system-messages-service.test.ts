import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { getManualModerationVisibility, updateManualModerationVisibility, DEFAULT_MANUAL_MODERATION_VISIBILITY } from "./manual-moderation-settings-service";
import { getSystemMessages, updateSystemMessages } from "./system-messages-service";

const ADMIN_EMAIL = "system-messages-ci@example.com";

async function cleanup() {
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("getSystemMessages falls back to app defaults when no Global*Settings rows exist", async () => {
  // GlobalModerationSettings/GlobalManualModerationSettings/GlobalCaptchaSettings/
  // GlobalContentSettings are shared singleton rows other test files also touch --
  // this only asserts the shape, not exact values, to stay independent of that.
  const messages = await getSystemMessages();
  assert.equal(typeof messages.automod.escalationMuteMessageTemplate, "string");
  assert.equal(typeof messages.automod.escalationBanMessageTemplate, "string");
  assert.equal(messages.automod.mediaFilters.length, 12);
  assert.equal(typeof messages.manualModeration.warnMessageTemplate, "string");
  assert.equal(typeof messages.captcha.challengeMessageTemplate, "string");
  assert.equal(typeof messages.content.welcomeMessageTemplate, "string");
});

test("updateSystemMessages persists all 4 domains and getSystemMessages reads them back", async () => {
  await cleanup();
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  const before = await getSystemMessages();

  try {
    const saved = await updateSystemMessages({
      actingAdminId: admin.id,
      automod: {
        escalationMuteMessageTemplate: "MUTE %target%",
        escalationBanMessageTemplate: "BAN %target%",
        mediaFilters: before.automod.mediaFilters.map((rule) => (rule.type === "PHOTO" ? { ...rule, notifyText: "no photos" } : rule))
      },
      manualModeration: { ...before.manualModeration, warnMessageTemplate: "WARN %target%" },
      captcha: { challengeMessageTemplate: "prove you're human" },
      content: { welcomeMessageTemplate: "hi {name}" }
    });

    assert.equal(saved.automod.escalationMuteMessageTemplate, "MUTE %target%");
    assert.equal(saved.automod.escalationBanMessageTemplate, "BAN %target%");
    assert.equal(saved.automod.mediaFilters.find((rule) => rule.type === "PHOTO")?.notifyText, "no photos");
    assert.equal(saved.manualModeration.warnMessageTemplate, "WARN %target%");
    assert.equal(saved.captcha.challengeMessageTemplate, "prove you're human");
    assert.equal(saved.content.welcomeMessageTemplate, "hi {name}");

    const reloaded = await getSystemMessages();
    assert.equal(reloaded.automod.escalationMuteMessageTemplate, "MUTE %target%");
    assert.equal(reloaded.manualModeration.warnMessageTemplate, "WARN %target%");
    assert.equal(reloaded.captcha.challengeMessageTemplate, "prove you're human");
    assert.equal(reloaded.content.welcomeMessageTemplate, "hi {name}");
  } finally {
    await updateSystemMessages({ actingAdminId: admin.id, ...before });
    await cleanup();
  }
});

test("updateSystemMessages never touches GlobalManualModerationSettings' visibility flags", async () => {
  await cleanup();
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    await updateManualModerationVisibility({
      actingAdminId: admin.id,
      visibility: { ...DEFAULT_MANUAL_MODERATION_VISIBILITY, publicPunishmentMessagesEnabled: false }
    });

    const before = await getSystemMessages();
    await updateSystemMessages({
      actingAdminId: admin.id,
      ...before,
      manualModeration: { ...before.manualModeration, warnMessageTemplate: "WARN %target% v2" }
    });

    const visibility = await getManualModerationVisibility();
    assert.equal(visibility.publicPunishmentMessagesEnabled, false, "updateSystemMessages must not reset visibility set separately");
  } finally {
    await updateManualModerationVisibility({ actingAdminId: admin.id, visibility: DEFAULT_MANUAL_MODERATION_VISIBILITY });
    await cleanup();
  }
});
