import assert from "node:assert/strict";
import test from "node:test";
import { isExpiredMuteCandidate } from "./punishment-expiration-service";

const now = new Date("2026-08-18T12:00:00.000Z");

test("only an expired temporary mute is selected for automatic release", () => {
  assert.equal(isExpiredMuteCandidate({ punishmentState: "MUTED", punishmentExpiresAt: new Date("2026-08-18T11:59:00.000Z") }, now), true);
  assert.equal(isExpiredMuteCandidate({ punishmentState: "MUTED", punishmentExpiresAt: new Date("2026-08-18T12:01:00.000Z") }, now), false);
  assert.equal(isExpiredMuteCandidate({ punishmentState: "BANNED", punishmentExpiresAt: new Date("2026-08-18T11:59:00.000Z") }, now), false);
  assert.equal(isExpiredMuteCandidate({ punishmentState: "MUTED", punishmentExpiresAt: null }, now), false);
});
