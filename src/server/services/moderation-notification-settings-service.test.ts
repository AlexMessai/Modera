import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MANUAL_MODERATION_SETTINGS } from "./manual-moderation-settings-service";
import { normalizeModerationNotificationProfiles, renderTelegramModerationNotification } from "./moderation-notification-settings-service";

const legacy = {
  publicPunishmentMessagesEnabled: false,
  privatePunishmentMessagesEnabled: true,
  ...DEFAULT_MANUAL_MODERATION_SETTINGS
};

test("empty notification profiles preserve legacy visibility and templates", () => {
  const profiles = normalizeModerationNotificationProfiles([], legacy);
  const warning = profiles.find((profile) => profile.event === "WARNING");
  const unmute = profiles.find((profile) => profile.event === "UNMUTE");

  assert.equal(profiles.length, 7);
  assert.equal(warning?.channels.PUBLIC.enabled, false);
  assert.equal(warning?.channels.OFFENDER.enabled, true);
  assert.equal(warning?.channels.OFFENDER.templates.MANUAL, legacy.warnEphemeralMessageTemplate);
  assert.equal(warning?.channels.OFFENDER.templates.AUTOMATED, legacy.warnEphemeralMessageTemplate);
  assert.equal(warning?.channels.MODERATOR.templates.MANUAL, "%admin% выдал предупреждение пользователю %target%. Причина: %reason%");
  assert.equal(warning?.channels.MODERATOR.templates.AUTOMATED, legacy.warnMessageTemplate);
  assert.equal(unmute?.channels.OFFENDER.enabled, false, "new channels must stay opt-in during migration");
});

test("profiles independently normalize every audience", () => {
  const profiles = normalizeModerationNotificationProfiles([
    {
      event: "MUTE",
      channels: {
        OFFENDER: { enabled: false, text: "Личное: %target%" },
        PUBLIC: { enabled: true, text: "Публичное: %target%" },
        MODERATOR: { enabled: false, text: "Подтверждение: %target%" }
      }
    }
  ], legacy);
  const mute = profiles.find((profile) => profile.event === "MUTE");

  assert.deepEqual(mute?.channels, {
    OFFENDER: { enabled: false, templates: { MANUAL: "Личное: %target%", AUTOMATED: legacy.muteEphemeralMessageTemplate } },
    PUBLIC: { enabled: true, templates: { MANUAL: "Публичное: %target%", AUTOMATED: legacy.muteMessageTemplate } },
    MODERATOR: { enabled: false, templates: { MANUAL: "Подтверждение: %target%", AUTOMATED: legacy.muteMessageTemplate } }
  });
});

test("manual and automated templates stay independent and Telegram users become links", () => {
  const profiles = normalizeModerationNotificationProfiles([{
    event: "BAN",
    channels: {
      PUBLIC: { enabled: true, templates: { MANUAL: "%admin% заблокировал %target%", AUTOMATED: "Автомод заблокировал %target%" } }
    }
  }], legacy);
  const channel = profiles.find((profile) => profile.event === "BAN")!.channels.PUBLIC;
  const rendered = renderTelegramModerationNotification(channel, "MANUAL", {
    admin: { text: "Алексей", telegramUserId: 101 },
    target: { text: "Иван", telegramUserId: 202 }
  });

  assert.equal(rendered.text, "Алексей заблокировал Иван");
  assert.deepEqual(rendered.entities, [
    { type: "text_link", offset: 0, length: 7, url: "tg://user?id=101" },
    { type: "text_link", offset: 21, length: 4, url: "tg://user?id=202" }
  ]);
  assert.equal(channel.templates.AUTOMATED, "Автомод заблокировал %target%");
});

test("notification formatting is converted to Telegram entities without breaking clickable users", () => {
  const profiles = normalizeModerationNotificationProfiles([{
    event: "BAN",
    channels: { PUBLIC: { enabled: true, templates: { MANUAL: "<b>%admin%</b> заблокировал <tg-spoiler>%target%</tg-spoiler>", AUTOMATED: "%target%" } } }
  }], legacy);
  const rendered = renderTelegramModerationNotification(profiles.find((profile) => profile.event === "BAN")!.channels.PUBLIC, "MANUAL", {
    admin: { text: "Алексей", telegramUserId: 101 }, target: { text: "Иван", telegramUserId: 202 }
  });
  assert.equal(rendered.text, "Алексей заблокировал Иван");
  assert.deepEqual(rendered.entities, [
    { type: "text_link", offset: 0, length: 7, url: "tg://user?id=101" },
    { type: "bold", offset: 0, length: 7 },
    { type: "text_link", offset: 21, length: 4, url: "tg://user?id=202" },
    { type: "spoiler", offset: 21, length: 4 }
  ]);
});
