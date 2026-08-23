-- Mirrors TelegramUser's avatarSyncedAt cadence field so Chat photos can be
-- cached/refreshed the same way (see telegram-avatar-service.ts). Chat.photoFileId
-- already existed but was never wired up to a sync path.
ALTER TABLE "Chat" ADD COLUMN "avatarSyncedAt" TIMESTAMPTZ(3);
