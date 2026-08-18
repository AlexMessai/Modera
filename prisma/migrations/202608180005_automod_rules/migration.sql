ALTER TABLE "Message"
ADD COLUMN "automodRevisionAt" TIMESTAMPTZ(3),
ADD COLUMN "automodClaimedAt" TIMESTAMPTZ(3),
ADD COLUMN "automodResult" VARCHAR(50),
ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

CREATE TABLE "ChatModerationSettings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL UNIQUE,
  "blockLinks" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "spamEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "spamWindowSeconds" INTEGER NOT NULL DEFAULT 10,
  "spamMaxMessages" INTEGER NOT NULL DEFAULT 5,
  "ignoreAdmins" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatModerationSettings_chatId_fkey"
    FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE,
  CONSTRAINT "ChatModerationSettings_spamWindowSeconds_check"
    CHECK ("spamWindowSeconds" BETWEEN 3 AND 120),
  CONSTRAINT "ChatModerationSettings_spamMaxMessages_check"
    CHECK ("spamMaxMessages" BETWEEN 2 AND 50)
);
