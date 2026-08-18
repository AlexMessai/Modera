import assert from "node:assert/strict";
import test from "node:test";
import { effectiveMembershipStatus, effectivePunishmentState, isMuteExpired } from "./punishment-state";

const now = new Date("2026-08-18T12:00:00.000Z");

test("expired Telegram mute is inactive without waiting for cron", () => {
  const member = { status: "RESTRICTED", punishmentState: "MUTED", punishmentExpiresAt: new Date("2026-08-18T11:59:00.000Z") };
  assert.equal(isMuteExpired(member, now), true);
  assert.equal(effectivePunishmentState(member, now), null);
  assert.equal(effectiveMembershipStatus(member, now), "MEMBER");
});

test("active and permanent punishments stay unchanged", () => {
  assert.equal(effectivePunishmentState({ punishmentState: "MUTED", punishmentExpiresAt: new Date("2026-08-18T12:01:00.000Z") }, now), "MUTED");
  assert.equal(effectivePunishmentState({ punishmentState: "BANNED", punishmentExpiresAt: null }, now), "BANNED");
});
