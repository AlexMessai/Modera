import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDurationToken, parseModerationCommandArguments } from "@/server/telegram/command-parser";

test("parseDurationToken: unit suffixes", () => {
  assert.equal(parseDurationToken("30m"), 30);
  assert.equal(parseDurationToken("3h"), 180);
  assert.equal(parseDurationToken("7d"), 10080);
  assert.equal(parseDurationToken("3H"), 180);
});

test("parseDurationToken: a bare number with no unit is not a valid duration anymore", () => {
  assert.equal(parseDurationToken("180"), null);
  assert.equal(parseDurationToken("10"), null);
});

test("parseDurationToken: non-duration text and zero-amount tokens return null", () => {
  assert.equal(parseDurationToken("спам"), null);
  assert.equal(parseDurationToken("0"), null);
  assert.equal(parseDurationToken("0m"), null);
  assert.equal(parseDurationToken(""), null);
});

test("reason only, no duration token at all: permanent, full reason kept", () => {
  const result = parseModerationCommandArguments("спам в чате", { allowDuration: true });
  assert.deepEqual(result.targetTokens, []);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.durationUnitMissing, false);
  assert.equal(result.reason, "спам в чате");
});

test("bare number where a duration could go is flagged, not read as minutes or folded into the reason", () => {
  const result = parseModerationCommandArguments("180 флуд в чате", { allowDuration: true });
  assert.equal(result.durationMinutes, null);
  assert.equal(result.durationUnitMissing, true);
});

test("bare number is only flagged when a duration is actually expected for this command", () => {
  const result = parseModerationCommandArguments("5 раз нарушал правила", { allowDuration: false });
  assert.deepEqual(result.targetTokens, []);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.durationUnitMissing, false);
  assert.equal(result.reason, "5 раз нарушал правила");
});

test("single @username target with unit duration and reason", () => {
  const result = parseModerationCommandArguments("@user 3h флуд", { allowDuration: true });
  assert.deepEqual(result.targetTokens, [{ type: "username", value: "user" }]);
  assert.equal(result.durationMinutes, 180);
  assert.equal(result.durationUnitMissing, false);
  assert.equal(result.reason, "флуд");
});

test("unit-suffixed duration is never expected/consumed for a command without allowDuration", () => {
  const result = parseModerationCommandArguments("@user 7d спам", { allowDuration: false });
  assert.deepEqual(result.targetTokens, [{ type: "username", value: "user" }]);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.reason, "7d спам");
});

test("@username target followed by a bare number fails the same way as /ban", () => {
  const result = parseModerationCommandArguments("@user 10 спам", { allowDuration: true });
  assert.deepEqual(result.targetTokens, [{ type: "username", value: "user" }]);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.durationUnitMissing, true);
});

test("numeric Telegram ID target is distinguished from a short duration number", () => {
  const result = parseModerationCommandArguments("123456789 30m спам", { allowDuration: true });
  assert.deepEqual(result.targetTokens, [{ type: "id", value: 123456789 }]);
  assert.equal(result.durationMinutes, 30);
  assert.equal(result.durationUnitMissing, false);
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

test("empty args", () => {
  const result = parseModerationCommandArguments("", { allowDuration: true });
  assert.deepEqual(result.targetTokens, []);
  assert.equal(result.durationMinutes, null);
  assert.equal(result.durationUnitMissing, false);
  assert.equal(result.reason, null);
});
