import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_ANTI_RAID_SETTINGS,
  normalizeAntiRaidSettings,
  resolveEffectiveAntiRaidSettings,
  updateChatAntiRaidSettings,
  updateGlobalAntiRaidProfile
} from "./anti-raid-settings-service";

const CHAT_ID = -1009000013001n;
const ADMIN_EMAIL = "anti-raid-settings-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("anti-raid settings are normalized: booleans coerced, numeric fields clamped to bounds", () => {
  const normalized = normalizeAntiRaidSettings({
    ...DEFAULT_ANTI_RAID_SETTINGS,
    enabled: true,
    joinThreshold: 1,
    windowSeconds: 999999,
    cooldownMinutes: -5
  });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.joinThreshold, 3);
  assert.equal(normalized.windowSeconds, 600);
  assert.equal(normalized.cooldownMinutes, 1);

  assert.equal(normalizeAntiRaidSettings({ ...DEFAULT_ANTI_RAID_SETTINGS, forceCaptcha: false }).forceCaptcha, false);
});

test("a chat that never chose follows the global profile; opting out uses its own settings", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Anti-Raid Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    await updateGlobalAntiRaidProfile({
      actingAdminId: admin.id,
      settings: { ...DEFAULT_ANTI_RAID_SETTINGS, enabled: true, joinThreshold: 40 }
    });

    const beforeAnyChatEdit = await resolveEffectiveAntiRaidSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "GLOBAL");
    assert.equal(beforeAnyChatEdit.settings.enabled, true);
    assert.equal(beforeAnyChatEdit.settings.joinThreshold, 40);

    const saved = await updateChatAntiRaidSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      useGlobalProfile: false,
      settings: { ...DEFAULT_ANTI_RAID_SETTINGS, enabled: false, joinThreshold: 10 }
    });
    assert.equal(saved?.useGlobalProfile, false);

    const optedOut = await resolveEffectiveAntiRaidSettings(chat.id);
    assert.equal(optedOut.source, "CHAT");
    assert.equal(optedOut.settings.enabled, false);
    assert.equal(optedOut.settings.joinThreshold, 10);
  } finally {
    await updateGlobalAntiRaidProfile({ actingAdminId: admin.id, settings: DEFAULT_ANTI_RAID_SETTINGS });
    await cleanup();
  }
});
