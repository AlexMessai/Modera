-- Manual moderation UI/logic overhaul: replace the 7 duplicated per-command
-- "AnnounceInChat" columns (one per warn/unwarn/mute/unmute/ban/unban/kick,
-- on both tables) with a single global source of truth for whether
-- punishment notices go out at all -- public (group chat) and private
-- (ephemeral/DM) tracked independently, plus a proactive-DM toggle for
-- bot-initiated DMs that aren't a direct reply to a command.
ALTER TABLE "ChatManualModerationSettings"
  DROP COLUMN "warnAnnounceInChat",
  DROP COLUMN "unwarnAnnounceInChat",
  DROP COLUMN "muteAnnounceInChat",
  DROP COLUMN "unmuteAnnounceInChat",
  DROP COLUMN "banAnnounceInChat",
  DROP COLUMN "unbanAnnounceInChat",
  DROP COLUMN "kickAnnounceInChat";

ALTER TABLE "GlobalManualModerationSettings"
  DROP COLUMN "warnAnnounceInChat",
  DROP COLUMN "unwarnAnnounceInChat",
  DROP COLUMN "muteAnnounceInChat",
  DROP COLUMN "unmuteAnnounceInChat",
  DROP COLUMN "banAnnounceInChat",
  DROP COLUMN "unbanAnnounceInChat",
  DROP COLUMN "kickAnnounceInChat",
  ADD COLUMN "publicPunishmentMessagesEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "privatePunishmentMessagesEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "proactiveDmNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
