import assert from "node:assert/strict";
import test from "node:test";
import { canManageChatSettings, canModerate, canViewSystem } from "./permissions";

test("moderation RBAC allows owner admin and moderator only", () => {
  assert.equal(canModerate("OWNER"), true);
  assert.equal(canModerate("ADMIN"), true);
  assert.equal(canModerate("MODERATOR"), true);
  assert.equal(canModerate("VIEWER"), false);
  assert.equal(canModerate("UNKNOWN"), false);
});

test("chat policy settings are limited to owner and admin", () => {
  assert.equal(canManageChatSettings("OWNER"), true);
  assert.equal(canManageChatSettings("ADMIN"), true);
  assert.equal(canManageChatSettings("MODERATOR"), false);
  assert.equal(canManageChatSettings("VIEWER"), false);
  assert.equal(canManageChatSettings("UNKNOWN"), false);
});

test("system diagnostics are limited to owner and admin", () => {
  assert.equal(canViewSystem("OWNER"), true);
  assert.equal(canViewSystem("ADMIN"), true);
  assert.equal(canViewSystem("MODERATOR"), false);
  assert.equal(canViewSystem("VIEWER"), false);
  assert.equal(canViewSystem("UNKNOWN"), false);
});
