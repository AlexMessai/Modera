import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MANUAL_MODERATION_SETTINGS } from "./manual-moderation-settings-service";
import { normalizeModerationNotificationProfiles } from "./moderation-notification-settings-service";

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
  assert.equal(warning?.channels.OFFENDER.text, legacy.warnEphemeralMessageTemplate);
  assert.equal(warning?.channels.MODERATOR.text, legacy.warnMessageTemplate);
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
    OFFENDER: { enabled: false, text: "Личное: %target%" },
    PUBLIC: { enabled: true, text: "Публичное: %target%" },
    MODERATOR: { enabled: false, text: "Подтверждение: %target%" }
  });
});
