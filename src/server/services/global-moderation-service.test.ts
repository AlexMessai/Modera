import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { updateChatModerationSettings } from "./chat-moderation-settings-service";
import {
  DEFAULT_MODERATION_SETTINGS,
  DEFAULT_MEDIA_FILTERS,
  findEnabledMediaFilterRule,
  findTriggeredEscalationRule,
  lowestEscalationThreshold,
  MEDIA_FILTER_TYPES,
  normalizeAutomodRuleActions,
  normalizeModerationSettings,
  normalizeEscalationRules,
  normalizeMediaFilters,
  resolveEffectiveModerationSettings
} from "./global-moderation-service";

test("normalizeAutomodRuleActions preserves legacy escalation behavior and validates explicit outcomes", () => {
  const legacy = normalizeAutomodRuleActions([], true);
  assert.equal(legacy.length, 5);
  assert.ok(legacy.every((rule) => rule.deleteMessage && rule.punishmentEnabled && rule.punishmentAction === "WARN"));

  const explicit = normalizeAutomodRuleActions([{
    rule: "SPAM",
    deleteMessage: false,
    punishmentEnabled: true,
    punishmentAction: "MUTE",
    muteDurationMinutes: 999999,
    notifyEnabled: true,
    notifyText: "  Слишком быстро  "
  }]);
  const spam = explicit.find((rule) => rule.rule === "SPAM")!;
  assert.equal(spam.deleteMessage, false);
  assert.equal(spam.punishmentAction, "MUTE");
  assert.equal(spam.muteDurationMinutes, 43200);
  assert.equal(spam.notifyText, "Слишком быстро");
});

test("rule enabled flags and delete outcomes share one state", () => {
  const inconsistent = {
    ...DEFAULT_MODERATION_SETTINGS,
    linkEnabled: false,
    spamEnabled: true,
    ruleActions: DEFAULT_MODERATION_SETTINGS.ruleActions.map((action) => action.rule === "LINK"
      ? { ...action, deleteMessage: true }
      : action.rule === "SPAM"
        ? { ...action, deleteMessage: false }
        : action)
  };
  const normalized = normalizeModerationSettings(inconsistent);

  assert.equal(normalized.ruleActions.find((action) => action.rule === "LINK")?.deleteMessage, false);
  assert.equal(normalized.ruleActions.find((action) => action.rule === "SPAM")?.deleteMessage, true);
});

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

test("normalizeMediaFilters always returns all 12 types, defaulting anything missing or malformed", () => {
  assert.deepEqual(normalizeMediaFilters("not an array"), DEFAULT_MEDIA_FILTERS);
  assert.deepEqual(normalizeMediaFilters([{ type: "NOT_A_TYPE", enabled: true }]), DEFAULT_MEDIA_FILTERS);

  const normalized = normalizeMediaFilters([
    { type: "PHOTO", enabled: true, warnOnTrigger: 1, notifyEnabled: "yes", notifyText: "  🚫 нельзя  " },
    { type: "DICE", enabled: true, warnOnTrigger: false, notifyEnabled: false, notifyText: "" },
    { type: "STICKER", enabled: true, deleteMessage: false, punishmentEnabled: true, punishmentAction: "MUTE", muteDurationMinutes: 1440, notifyEnabled: true, notifyText: "  без стикеров  " }
  ]);
  assert.equal(normalized.length, MEDIA_FILTER_TYPES.length);
  assert.equal(normalized.map((rule) => rule.type).join(","), MEDIA_FILTER_TYPES.join(","));

  const photo = normalized.find((rule) => rule.type === "PHOTO")!;
  assert.equal(photo.enabled, true);
  assert.equal(photo.deleteMessage, true);
  assert.equal(photo.punishmentEnabled, true);
  assert.equal(photo.punishmentAction, "WARN");
  assert.equal(photo.muteDurationMinutes, 60);
  assert.equal(photo.warnOnTrigger, true);
  assert.equal(photo.notifyEnabled, true);
  assert.equal(photo.notifyText, "🚫 нельзя");

  const dice = normalized.find((rule) => rule.type === "DICE")!;
  assert.equal(dice.enabled, true);
  assert.equal(dice.notifyText, "");

  const video = normalized.find((rule) => rule.type === "VIDEO")!;
  assert.equal(video.enabled, false);

  const sticker = normalized.find((rule) => rule.type === "STICKER")!;
  assert.equal(sticker.deleteMessage, false);
  assert.equal(sticker.punishmentEnabled, true);
  assert.equal(sticker.punishmentAction, "MUTE");
  assert.equal(sticker.muteDurationMinutes, 1440);
  assert.equal(sticker.notifyText, "без стикеров");
});

test("findEnabledMediaFilterRule returns the rule only when its type is enabled", () => {
  const rules = normalizeMediaFilters([{ type: "AUDIO", enabled: true, warnOnTrigger: true, notifyEnabled: false, notifyText: "x" }]);
  assert.equal(findEnabledMediaFilterRule(rules, "AUDIO")?.type, "AUDIO");
  assert.equal(findEnabledMediaFilterRule(rules, "VOICE"), null);
  assert.equal(findEnabledMediaFilterRule(rules, "DOCUMENT"), null);
});

test("media filter allow/delete changes persist and are returned on the next read", async () => {
  const telegramChatId = -1009000000703n;
  const adminEmail = "media-filter-save-ci@example.com";
  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
  const chat = await prisma.chat.create({ data: { telegramChatId, title: "Media filter save CI", type: "supergroup" } });
  const admin = await prisma.adminUser.create({ data: { email: adminEmail, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" } });

  try {
    const saved = await updateChatModerationSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      ...DEFAULT_MODERATION_SETTINGS,
      mediaFilters: DEFAULT_MEDIA_FILTERS.map((rule) => rule.type === "PHOTO" ? { ...rule, enabled: true, deleteMessage: true } : rule)
    });
    assert.equal(saved?.mediaFilters.find((rule) => rule.type === "PHOTO")?.enabled, true);

    const afterDelete = await resolveEffectiveModerationSettings(chat.id);
    assert.equal(afterDelete.settings.mediaFilters.find((rule) => rule.type === "PHOTO")?.enabled, true);

    await updateChatModerationSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      ...afterDelete.settings,
      mediaFilters: afterDelete.settings.mediaFilters.map((rule) => rule.type === "PHOTO" ? { ...rule, enabled: false, deleteMessage: false } : rule)
    });
    const afterAllow = await resolveEffectiveModerationSettings(chat.id);
    const photo = afterAllow.settings.mediaFilters.find((rule) => rule.type === "PHOTO");
    assert.equal(photo?.enabled, false);
    assert.equal(photo?.deleteMessage, false);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.adminUser.delete({ where: { id: admin.id } });
  }
});

test("chat moderation always reads the chat's own settings, ignoring any GlobalModerationSettings row", async () => {
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
    // A GlobalModerationSettings row exists but must have zero effect now
    // that inheritance is removed -- everything below asserts against the
    // chat's own row only.
    await prisma.globalModerationSettings.upsert({
      where: { id: "global" },
      create: {
        id: "global",
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
        spamEnabled: false
      }
    });

    const resolved = await resolveEffectiveModerationSettings(chat.id);
    assert.equal(resolved.source, "CHAT");
    assert.equal(resolved.useGlobalProfile, false);
    assert.equal(resolved.settings.linkProtectionMode, "ALLOW_ALL");
    assert.equal(resolved.settings.spamEnabled, false);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
  }
});

test("a chat with no ChatModerationSettings row at all falls back to app defaults, not the global profile", async () => {
  const telegramChatId = -1009000000702n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });

  const chat = await prisma.chat.create({
    data: { telegramChatId, title: "Global policy CI (unconfigured)", type: "supergroup" }
  });

  try {
    await prisma.globalModerationSettings.upsert({
      where: { id: "global" },
      create: { id: "global", spamEnabled: true, spamWindowSeconds: 12, spamMaxMessages: 3 },
      update: { spamEnabled: true, spamWindowSeconds: 12, spamMaxMessages: 3 }
    });

    // No ChatModerationSettings row was ever created for this chat -- it must
    // fall back to DEFAULT_MODERATION_SETTINGS, never the global profile.
    const resolved = await resolveEffectiveModerationSettings(chat.id);
    assert.equal(resolved.source, "CHAT");
    assert.equal(resolved.useGlobalProfile, false);
    assert.equal(resolved.settings.spamEnabled, false);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
  }
});
