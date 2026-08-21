import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDurationToken, parseModerationCommandArguments } from "@/server/telegram/command-parser";

test("parseDurationToken: bare number is minutes", () => {
  assert.equal(parseDurationToken("180"), 180);
});

test("parseDurationToken: unit suffixes", () => {
  assert.equal(parseDurationToken("30m"), 30);
  assert.equal(parseDurationToken("3h"), 180);
  assert.equal(parseDurationToken("7d"), 10080);
  assert.equal(parseDurationToken("3H"), 180);
});

test("parseDurationToken: non-duration text returns null", () => {
  assert.equal(parseDurationToken("спам"), null);
  assert.equal(parseDurationToken("0"), null);
  assert.equal(parseDurationToken(""), null);
});

test("legacy syntax: bare minutes + reason, no target tokens", () => {
  const result = parseModerationCommandArguments("180 флуд в чате", { allowDuration: true });
  assert.deepEqual(result.targetTokens, []);
  assert.equal(result.durationMinutes, 180);
  assert.equal(result.reason, "флуд в чате");
});

test("legacy syntax: reason only (warn/ban), no duration consumed", () => {
  const result = parseModerationCommandArguments("спам в чате", { allowDuration: false });
  assert.deepEqual(result.targetTokens, []);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.reason, "спам в чате");
});

test("reason starting with a number is preserved when duration isn't allowed", () => {
  const result = parseModerationCommandArguments("5 раз нарушал правила", { allowDuration: false });
  assert.deepEqual(result.targetTokens, []);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.reason, "5 раз нарушал правила");
});

test("single @username target with unit duration and reason", () => {
  const result = parseModerationCommandArguments("@user 3h флуд", { allowDuration: true });
  assert.deepEqual(result.targetTokens, [{ type: "username", value: "user" }]);
  assert.equal(result.durationMinutes, 180);
  assert.equal(result.reason, "флуд");
});

test("single @username target, no duration allowed (ban)", () => {
  const result = parseModerationCommandArguments("@user 7d спам", { allowDuration: false });
  assert.deepEqual(result.targetTokens, [{ type: "username", value: "user" }]);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.reason, "7d спам");
});

test("numeric Telegram ID target is distinguished from a short duration number", () => {
  const result = parseModerationCommandArguments("123456789 30m спам", { allowDuration: true });
  assert.deepEqual(result.targetTokens, [{ type: "id", value: 123456789 }]);
  assert.equal(result.durationMinutes, 30);
  assert.equal(result.reason, "спам");
});

test("multiple targets, no duration, no reason", () => {
  const result = parseModerationCommandArguments("@user1 @user2 @user3", { allowDuration: false });
  assert.deepEqual(result.targetTokens, [
    { type: "username", value: "user1" },
    { type: "username", value: "user2" },
    { type: "username", value: "user3" }
  ]);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.reason, null);
});

test("mixed username and ID targets", () => {
  const result = parseModerationCommandArguments("@user1 987654321 реклама", { allowDuration: false });
  assert.deepEqual(result.targetTokens, [
    { type: "username", value: "user1" },
    { type: "id", value: 987654321 }
  ]);
  assert.equal(result.reason, "реклама");
});

test("requireDurationUnit: bare number is left in the reason, not read as a duration", () => {
  const result = parseModerationCommandArguments("5 нарушений подряд", { allowDuration: true, requireDurationUnit: true });
  assert.equal(result.durationMinutes, null);
  assert.equal(result.reason, "5 нарушений подряд");
});

test("requireDurationUnit: a unit-suffixed number is still read as a duration", () => {
  const result = parseModerationCommandArguments("@user 7d спам", { allowDuration: true, requireDurationUnit: true });
  assert.deepEqual(result.targetTokens, [{ type: "username", value: "user" }]);
  assert.equal(result.durationMinutes, 10080);
  assert.equal(result.reason, "спам");
});

test("empty args", () => {
  const result = parseModerationCommandArguments("", { allowDuration: true });
  assert.deepEqual(result.targetTokens, []);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.reason, null);
});
