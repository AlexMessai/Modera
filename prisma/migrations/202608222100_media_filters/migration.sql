-- Filters module (§ Content Filters, media types): per-type rules for the 7
-- media types previously only managed as one undifferentiated group in
-- blockedMessageTypes -- see automod-service.ts / global-moderation-service.ts.
ALTER TABLE "ChatModerationSettings" ADD COLUMN "mediaFilters" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "GlobalModerationSettings" ADD COLUMN "mediaFilters" JSONB NOT NULL DEFAULT '[]';
