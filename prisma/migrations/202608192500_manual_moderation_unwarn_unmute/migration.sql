ALTER TABLE "ChatManualModerationSettings"
  ADD COLUMN "unwarnMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '✅ С %target% снято предупреждение (осталось %warns% из %warns_limit%).',
  ADD COLUMN "unwarnDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unwarnDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unmuteMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '🔊 С %target% снят mute.',
  ADD COLUMN "unmuteDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unmuteDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GlobalManualModerationSettings"
  ADD COLUMN "unwarnMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '✅ С %target% снято предупреждение (осталось %warns% из %warns_limit%).',
  ADD COLUMN "unwarnDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unwarnDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unmuteMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '🔊 С %target% снят mute.',
  ADD COLUMN "unmuteDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unmuteDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false;

-- The warn template now reports the running warning count.
ALTER TABLE "ChatManualModerationSettings"
  ALTER COLUMN "warnMessageTemplate" SET DEFAULT '⚠️ %target% получил(а) предупреждение (%warns% из %warns_limit%). %reason%';
ALTER TABLE "GlobalManualModerationSettings"
  ALTER COLUMN "warnMessageTemplate" SET DEFAULT '⚠️ %target% получил(а) предупреждение (%warns% из %warns_limit%). %reason%';

UPDATE "ChatManualModerationSettings"
  SET "warnMessageTemplate" = '⚠️ %target% получил(а) предупреждение (%warns% из %warns_limit%). %reason%'
  WHERE "warnMessageTemplate" = '⚠️ %target% получил(а) предупреждение. %reason%';
UPDATE "GlobalManualModerationSettings"
  SET "warnMessageTemplate" = '⚠️ %target% получил(а) предупреждение (%warns% из %warns_limit%). %reason%'
  WHERE "warnMessageTemplate" = '⚠️ %target% получил(а) предупреждение. %reason%';

-- A chat with no explicit choice should follow the global profile: leaving this
-- false meant globally configured templates silently applied to no chat at all.
ALTER TABLE "ChatManualModerationSettings" ALTER COLUMN "useGlobalProfile" SET DEFAULT true;
