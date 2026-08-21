import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  findTriggeredEscalationRule,
  GLOBAL_MODERATION_PROFILE_ID,
  lowestEscalationThreshold,
  normalizeEscalationRules,
  resolveEffectiveModerationSettings
} from "./global-moderation-service";

test("findTriggeredEscalationRule picks the highest crossed-but-not-fired threshold", () => {
  const rules = [
    { order: 1, thresholdWarnings: 3, action: "MUTE" as const, durationMinutes: 10 },
    { order: 2, thresholdWarnings: 6, action: "BAN" as const, durationMinutes: null }
  ];
  // Below both thresholds.
  assert.equal(findTriggeredEscalationRule(rules, 2, 0), null);
  // Crosses mute only.
  assert.deepEqual(findTriggeredEscalationRule(rules, 3, 0), rules[0]);
  // Already fired mute (marker at 3) but still below ban.
  assert.equal(findTriggeredEscalationRule(rules, 5, 3), null);
  // Jumps straight past both thresholds in one hit — ban wins, not mute.
  assert.deepEqual(findTriggeredEscalationRule(rules, 6, 0), rules[1]);
  // Already fired ban (marker at 6) — nothing left to trigger.
  assert.equal(findTriggeredEscalationRule(rules, 9, 6), null);
});

test("lowestEscalationThreshold returns the smallest configured threshold, or null when empty", () => {
  assert.equal(lowestEscalationThreshold([]), null);
  assert.equal(
    lowestEscalationThreshold([
      { order: 1, thresholdWarnings: 6, action: "BAN", durationMinutes: null },
      { order: 2, thresholdWarnings: 3, action: "MUTE", durationMinutes: 10 }
    ]),
    3
  );
});

test("normalizeEscalationRules validates shape, bounds, and caps the list length", () => {
  assert.deepEqual(normalizeEscalationRules("not an array"), []);
  assert.deepEqual(normalizeEscalationRules([{ action: "KICK", thresholdWarnings: 3 }]), []);

  const normalized = normalizeEscalationRules([
    { order: 99, thresholdWarnings: 5000, action: "MUTE", durationMinutes: 999999 },
    { order: 1, thresholdWarnings: -1, action: "BAN", durationMinutes: null }
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].order, 1);
  assert.equal(normalized[0].thresholdWarnings, 999);
  assert.equal(normalized[0].durationMinutes, 10080);
  assert.equal(normalized[1].order, 2);
  assert.equal(normalized[1].thresholdWarnings, 1);
  assert.equal(normalized[1].durationMinutes, null);

  const tooMany = Array.from({ length: 30 }, (_, index) => ({
    order: index + 1,
    thresholdWarnings: index + 1,
    action: "MUTE" as const,
    durationMinutes: null
  }));
  assert.equal(normalizeEscalationRules(tooMany).length, 20);
});

test("chat moderation stays local by default and inherits global rules only after explicit opt-in", async () => {
  const telegramChatId = -1009000000701n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });

  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "Global policy CI",
      type: "supergroup"
    }
  });

  try {
    await prisma.globalModerationSettings.upsert({
      where: { id: GLOBAL_MODERATION_PROFILE_ID },
      create: {
        id: GLOBAL_MODERATION_PROFILE_ID,
        linkProtectionMode: "WHITELIST_ONLY",
        allowedDomains: ["example.com"],
        spamEnabled: true,
        spamWindowSeconds: 15,
        spamMaxMessages: 4
      },
      update: {
        linkProtectionMode: "WHITELIST_ONLY",
        allowedDomains: ["example.com"],
        spamEnabled: true,
        spamWindowSeconds: 15,
        spamMaxMessages: 4
      }
    });

    await prisma.chatModerationSettings.create({
      data: {
        chatId: chat.id,
        linkProtectionMode: "ALLOW_ALL",
        spamEnabled: false,
        useGlobalProfile: false
      }
    });

    const local = await resolveEffectiveModerationSettings(chat.id);
    assert.equal(local.source, "CHAT");
    assert.equal(local.useGlobalProfile, false);
    assert.equal(local.settings.linkProtectionMode, "ALLOW_ALL");
    assert.equal(local.settings.spamEnabled, false);

    await prisma.chatModerationSettings.update({
      where: { chatId: chat.id },
      data: { useGlobalProfile: true }
    });

    const inherited = await resolveEffectiveModerationSettings(chat.id);
    assert.equal(inherited.source, "GLOBAL");
    assert.equal(inherited.useGlobalProfile, true);
    assert.equal(inherited.settings.linkProtectionMode, "WHITELIST_ONLY");
    assert.equal(inherited.settings.allowedDomains[0], "example.com");
    assert.equal(inherited.settings.spamWindowSeconds, 15);
    assert.equal(inherited.settings.spamMaxMessages, 4);

    const localStored = await prisma.chatModerationSettings.findUniqueOrThrow({
      where: { chatId: chat.id }
    });
    assert.equal(localStored.linkProtectionMode, "ALLOW_ALL");
    assert.equal(localStored.spamEnabled, false);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
  }
});

test("a chat with no ChatModerationSettings row at all follows the global profile", async () => {
  const telegramChatId = -1009000000702n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });

  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "Global policy CI (unconfigured)", type: "supergroup" }
  });

  try {
    await prisma.globalModerationSettings.upsert({
      where: { id: GLOBAL_MODERATION_PROFILE_ID },
      create: { id: GLOBAL_MODERATION_PROFILE_ID, spamEnabled: true, spamWindowSeconds: 12, spamMaxMessages: 3 },
      update: { spamEnabled: true, spamWindowSeconds: 12, spamMaxMessages: 3 }
    });

    // No ChatModerationSettings row was ever created for this chat — it must
    // still inherit the global profile, otherwise a protective global policy
    // would silently apply to no chat at all until every chat is opened and
    // switched on by hand.
    const resolved = await resolveEffectiveModerationSettings(chat.id);
    assert.equal(resolved.source, "GLOBAL");
    assert.equal(resolved.useGlobalProfile, true);
    assert.equal(resolved.settings.spamEnabled, true);
    assert.equal(resolved.settings.spamWindowSeconds, 12);
  } finally {
    // GlobalModerationSettings is a shared singleton row -- other test files
    // running in the same suite read the real default (spamEnabled: false)
    // when nothing else has touched it, so leaving it enabled here would
    // silently break any later test that assumes an untouched chat is quiet.
    await prisma.globalModerationSettings.upsert({
      where: { id: GLOBAL_MODERATION_PROFILE_ID },
      create: { id: GLOBAL_MODERATION_PROFILE_ID },
      update: { spamEnabled: false, spamWindowSeconds: 10, spamMaxMessages: 5 }
    });
    await prisma.chat.delete({ where: { id: chat.id } });
  }
});
