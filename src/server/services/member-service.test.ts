import assert from "node:assert/strict";
import test from "node:test";
import {
  isMembershipStatus,
  mapTelegramMembershipStatus
} from "./member-service";

test("Telegram membership statuses map to internal statuses", () => {
  assert.equal(mapTelegramMembershipStatus("creator"), "CREATOR");
  assert.equal(mapTelegramMembershipStatus("administrator"), "ADMINISTRATOR");
  assert.equal(mapTelegramMembershipStatus("member"), "MEMBER");
  assert.equal(mapTelegramMembershipStatus("restricted"), "RESTRICTED");
  assert.equal(mapTelegramMembershipStatus("left"), "LEFT");
  assert.equal(mapTelegramMembershipStatus("kicked"), "BANNED");
  assert.equal(mapTelegramMembershipStatus("future_status"), "UNKNOWN");
});

test("member status filter only accepts supported values", () => {
  assert.equal(isMembershipStatus("MEMBER"), true);
  assert.equal(isMembershipStatus("PENDING"), true);
  assert.equal(isMembershipStatus("BANNED"), true);
  assert.equal(isMembershipStatus("member"), false);
  assert.equal(isMembershipStatus("INVALID"), false);
});
