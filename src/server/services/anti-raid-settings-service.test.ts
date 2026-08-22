import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_ANTI_RAID_SETTINGS,
  normalizeAntiRaidSettings,
  resolveEffectiveAntiRaidSettings,
  updateChatAntiRaidSettings
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

test("a chat with no settings row falls back to app defaults; saved settings are read back from the chat's own row", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Anti-Raid Settings CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const beforeAnyChatEdit = await resolveEffectiveAntiRaidSettings(chat.id);
    assert.equal(beforeAnyChatEdit.source, "CHAT");
    assert.equal(beforeAnyChatEdit.settings.enabled, DEFAULT_ANTI_RAID_SETTINGS.enabled);

    const saved = await updateChatAntiRaidSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { ...DEFAULT_ANTI_RAID_SETTINGS, enabled: true, joinThreshold: 10 }
    });
    assert.equal(saved?.enabled, true);
    assert.equal(saved?.joinThreshold, 10);

    const resolved = await resolveEffectiveAntiRaidSettings(chat.id);
    assert.equal(resolved.source, "CHAT");
    assert.equal(resolved.settings.enabled, true);
    assert.equal(resolved.settings.joinThreshold, 10);
  } finally {
    await cleanup();
  }
});
