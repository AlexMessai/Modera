-- Automod escalation (mute/ban by warning threshold) can now optionally be
-- announced in the chat, same way a manual /warn already is.
ALTER TABLE "ChatModerationSettings"
  ADD COLUMN "announceEscalationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "escalationMuteMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '🔇 %target% получил(а) mute на %duration% за нарушение правил чата. Предупреждений: %warns% из %warns_limit%.',
  ADD COLUMN "escalationBanMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '⛔ %target% заблокирован(а) за нарушение правил чата. Предупреждений: %warns% из %warns_limit%.';

ALTER TABLE "GlobalModerationSettings"
  ADD COLUMN "announceEscalationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "escalationMuteMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '🔇 %target% получил(а) mute на %duration% за нарушение правил чата. Предупреждений: %warns% из %warns_limit%.',
  ADD COLUMN "escalationBanMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '⛔ %target% заблокирован(а) за нарушение правил чата. Предупреждений: %warns% из %warns_limit%.';

-- The command message is now always deleted immediately in code, regardless of
-- outcome, so a per-action "delete command message" toggle would be inert UI.
ALTER TABLE "ChatManualModerationSettings"
  DROP COLUMN "warnDeleteCommandMessage",
  DROP COLUMN "unwarnDeleteCommandMessage",
  DROP COLUMN "muteDeleteCommandMessage",
  DROP COLUMN "unmuteDeleteCommandMessage",
  DROP COLUMN "banDeleteCommandMessage",
  DROP COLUMN "unbanDeleteCommandMessage";

ALTER TABLE "GlobalManualModerationSettings"
  DROP COLUMN "warnDeleteCommandMessage",
  DROP COLUMN "unwarnDeleteCommandMessage",
  DROP COLUMN "muteDeleteCommandMessage",
  DROP COLUMN "unmuteDeleteCommandMessage",
  DROP COLUMN "banDeleteCommandMessage",
  DROP COLUMN "unbanDeleteCommandMessage";
