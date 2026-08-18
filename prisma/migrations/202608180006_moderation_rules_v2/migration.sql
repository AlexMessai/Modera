ALTER TABLE "ChatModerationSettings"
ADD COLUMN "blockedTermsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "blockedTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "massMentionsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "maxMentions" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "duplicateEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "duplicateWindowSeconds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "duplicateMaxMessages" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "blockedMessageTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ChatModerationSettings"
ADD CONSTRAINT "ChatModerationSettings_maxMentions_check"
  CHECK ("maxMentions" BETWEEN 1 AND 50),
ADD CONSTRAINT "ChatModerationSettings_duplicateWindowSeconds_check"
  CHECK ("duplicateWindowSeconds" BETWEEN 5 AND 3600),
ADD CONSTRAINT "ChatModerationSettings_duplicateMaxMessages_check"
  CHECK ("duplicateMaxMessages" BETWEEN 1 AND 20);
