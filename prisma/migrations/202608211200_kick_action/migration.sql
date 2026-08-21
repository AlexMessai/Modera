-- Adds KICK as a full moderation action (removal from the chat without a
-- persistent ban record — Telegram-side this is ban+immediate unban, the
-- same pattern captcha's timeout-kick already uses), with the same chat-
-- reply message-template shape (message/delete-target/announce) the other
-- non-appealable actions (unwarn/unmute/unban) already have. No ephemeral
-- personal-notice field: unlike warn/mute/ban, a kick removes the member
-- from the chat as the very action itself, so there's no "still a member,
-- worth notifying in-place" moment for it, and (like ban) nothing persists
-- to appeal — wiring an ephemeral template here with no real sender behind
-- it would just be a dead setting.
ALTER TYPE "ModerationActionType" ADD VALUE 'KICK';

ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "kickMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '👢 %target% исключён(а) из чата. %reason%';
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "kickDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "kickAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "kickMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '👢 %target% исключён(а) из чата. %reason%';
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "kickDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "kickAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
