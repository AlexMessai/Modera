import assert from "node:assert/strict";
import test from "node:test";
import { canModerate } from "./permissions";

test("moderation RBAC allows owner admin and moderator only", () => {
  assert.equal(canModerate("OWNER"), true);
  assert.equal(canModerate("ADMIN"), true);
  assert.equal(canModerate("MODERATOR"), true);
  assert.equal(canModerate("VIEWER"), false);
  assert.equal(canModerate("UNKNOWN"), false);
});
