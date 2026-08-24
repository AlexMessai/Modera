ALTER TABLE "ChatManualModerationSettings"
ADD COLUMN "commandProfiles" JSONB NOT NULL DEFAULT '[]';
