import assert from "node:assert/strict";
import test from "node:test";
import { calculateMemberRisk } from "./member-risk-service";

const now = new Date("2026-08-18T12:00:00.000Z");

test("risk score stays low without negative signals", () => {
  const result = calculateMemberRisk({
    now,
    observedAt: new Date("2026-01-01T00:00:00.000Z"),
    isBot: false,
    isTrusted: false,
    activeWarningCount: 0,
    automodViolationCount: 0,
    recentPunishmentCount: 0
  });
  assert.equal(result.score, 0);
  assert.equal(result.level, "LOW");
  assert.deepEqual(result.reasons, []);
});

test("risk score explains and caps combined signals", () => {
  const result = calculateMemberRisk({
    now,
    observedAt: new Date("2026-08-18T10:00:00.000Z"),
    isBot: false,
    isTrusted: false,
    activeWarningCount: 4,
    automodViolationCount: 8,
    recentPunishmentCount: 3
  });
  assert.equal(result.score, 96);
  assert.equal(result.level, "CRITICAL");
  assert.deepEqual(result.reasons.map((reason) => reason.code), [
    "NEW_MEMBER_24H",
    "ACTIVE_WARNINGS",
    "AUTOMOD_VIOLATIONS",
    "RECENT_PUNISHMENTS"
  ]);
});

test("trusted membership safely overrides automatic risk signals", () => {
  const result = calculateMemberRisk({
    now,
    observedAt: now,
    isBot: false,
    isTrusted: true,
    activeWarningCount: 10,
    automodViolationCount: 10,
    recentPunishmentCount: 10
  });
  assert.equal(result.score, 0);
  assert.equal(result.level, "LOW");
  assert.equal(result.reasons[0]?.code, "TRUSTED_MEMBER");
});
