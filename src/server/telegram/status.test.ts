import assert from "node:assert/strict";
import test from "node:test";
import { deriveBotStatus, extractBotPermissions } from "./status";

test("administrator with moderation rights is active", () => {
  const member = {
    status: "administrator",
    user: { id: 1, is_bot: true, first_name: "Bot" },
    can_manage_chat: true,
    can_delete_messages: true,
    can_restrict_members: true,
    can_manage_tags: true
  } as const;

  assert.equal(deriveBotStatus(member), "ACTIVE");
  assert.equal(extractBotPermissions(member).canRestrictMembers, true);
  assert.equal(extractBotPermissions(member).canManageTags, true);
});

test("tag management falls back to pin permission for older Bot API payloads", () => {
  const permissions = extractBotPermissions({
    status: "administrator",
    user: { id: 1, is_bot: true, first_name: "Bot" },
    can_pin_messages: true
  });

  assert.equal(permissions.canManageTags, true);
});

test("administrator without restriction rights is insufficient", () => {
  const member = {
    status: "administrator",
    user: { id: 1, is_bot: true, first_name: "Bot" },
    can_manage_chat: true,
    can_delete_messages: true,
    can_restrict_members: false
  } as const;

  assert.equal(deriveBotStatus(member), "INSUFFICIENT_PERMISSIONS");
});

test("plain member is not admin and kicked bot is removed", () => {
  assert.equal(
    deriveBotStatus({
      status: "member",
      user: { id: 1, is_bot: true, first_name: "Bot" }
    }),
    "NOT_ADMIN"
  );

  assert.equal(
    deriveBotStatus({
      status: "kicked",
      user: { id: 1, is_bot: true, first_name: "Bot" }
    }),
    "REMOVED"
  );
});
