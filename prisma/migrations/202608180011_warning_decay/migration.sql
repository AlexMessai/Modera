ALTER TABLE "ChatModerationSettings"
ADD COLUMN "warningExpiryDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GlobalModerationSettings"
ADD COLUMN "warningExpiryDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ChatModerationSettings"
ADD CONSTRAINT "ChatModerationSettings_warningExpiryDays_check"
CHECK ("warningExpiryDays" BETWEEN 0 AND 3650);

ALTER TABLE "GlobalModerationSettings"
ADD CONSTRAINT "GlobalModerationSettings_warningExpiryDays_check"
CHECK ("warningExpiryDays" BETWEEN 0 AND 3650);