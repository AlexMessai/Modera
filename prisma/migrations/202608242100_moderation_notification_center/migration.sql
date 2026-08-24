ALTER TABLE "GlobalManualModerationSettings"
ADD COLUMN "notificationProfiles" JSONB NOT NULL DEFAULT '[]'::jsonb;
