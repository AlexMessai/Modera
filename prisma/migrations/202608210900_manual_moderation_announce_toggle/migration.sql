-- Per-command "show in chat" toggle for manual moderation replies, mirroring
-- automod's announceEscalationEnabled but with one switch per command instead
-- of one shared switch. Defaults to true (visible) so existing chats keep
-- their current behavior unchanged.
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "warnAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "unwarnAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "muteAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "unmuteAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "banAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatManualModerationSettings" ADD COLUMN "unbanAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "warnAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "unwarnAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "muteAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "unmuteAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "banAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GlobalManualModerationSettings" ADD COLUMN "unbanAnnounceInChat" BOOLEAN NOT NULL DEFAULT true;
