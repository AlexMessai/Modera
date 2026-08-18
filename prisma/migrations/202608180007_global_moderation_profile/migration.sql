ALTER TABLE "ChatModerationSettings"
ADD COLUMN "useGlobalProfile" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE "GlobalModerationSettings" (
  "id" TEXT PRIMARY KEY DEFAULT 'global',
  "blockLinks" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "spamEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "spamWindowSeconds" INTEGER NOT NULL DEFAULT 10,
  "spamMaxMessages" INTEGER NOT NULL DEFAULT 5,
  "blockedTermsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "blockedTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "massMentionsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "maxMentions" INTEGER NOT NULL DEFAULT 5,
  "duplicateEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "duplicateWindowSeconds" INTEGER NOT NULL DEFAULT 60,
  "duplicateMaxMessages" INTEGER NOT NULL DEFAULT 2,
  "blockedMessageTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ignoreAdmins" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GlobalModerationSettings_spamWindowSeconds_check"
    CHECK ("spamWindowSeconds" BETWEEN 3 AND 120),
  CONSTRAINT "GlobalModerationSettings_spamMaxMessages_check"
    CHECK ("spamMaxMessages" BETWEEN 2 AND 50),
  CONSTRAINT "GlobalModerationSettings_maxMentions_check"
    CHECK ("maxMentions" BETWEEN 1 AND 50),
  CONSTRAINT "GlobalModerationSettings_duplicateWindowSeconds_check"
    CHECK ("duplicateWindowSeconds" BETWEEN 5 AND 3600),
  CONSTRAINT "GlobalModerationSettings_duplicateMaxMessages_check"
    CHECK ("duplicateMaxMessages" BETWEEN 1 AND 20)
);