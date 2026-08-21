-- Replaces the two fixed escalation tiers (mute-at-N, ban-at-M) with an
-- arbitrary ordered rule chain, per BOT_PRODUCT_SPEC_FINAL_UPDATED.md §15
-- ("добавить/изменить/удалить/переставить правило"). The old
-- muteAfterWarnings/muteDurationMinutes/banAfterWarnings columns stay in
-- place (unread by app code from this release on) rather than being dropped
-- immediately, and every existing row's current 2-tier configuration is
-- copied into escalationRules so behavior doesn't change for any already-
-- configured chat.
ALTER TABLE "ChatModerationSettings" ADD COLUMN "escalationRules" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "GlobalModerationSettings" ADD COLUMN "escalationRules" JSONB NOT NULL DEFAULT '[]';

UPDATE "ChatModerationSettings" SET "escalationRules" = jsonb_build_array(
  jsonb_build_object('order', 1, 'thresholdWarnings', "muteAfterWarnings", 'action', 'MUTE', 'durationMinutes', "muteDurationMinutes"),
  jsonb_build_object('order', 2, 'thresholdWarnings', "banAfterWarnings", 'action', 'BAN', 'durationMinutes', NULL)
);

UPDATE "GlobalModerationSettings" SET "escalationRules" = jsonb_build_array(
  jsonb_build_object('order', 1, 'thresholdWarnings', "muteAfterWarnings", 'action', 'MUTE', 'durationMinutes', "muteDurationMinutes"),
  jsonb_build_object('order', 2, 'thresholdWarnings', "banAfterWarnings", 'action', 'BAN', 'durationMinutes', NULL)
);
