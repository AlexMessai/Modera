ALTER TABLE "ChatCaptchaSettings"
  ADD COLUMN "challengeButtonText" VARCHAR(64) NOT NULL DEFAULT '✅ Я не бот',
  ADD COLUMN "deleteAfterVerification" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "GlobalCaptchaSettings"
  ADD COLUMN "challengeButtonText" VARCHAR(64) NOT NULL DEFAULT '✅ Я не бот',
  ADD COLUMN "deleteAfterVerification" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ChatContentSettings"
  ADD COLUMN "welcomeButtons" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "muteNewMembersMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "blockRtlNames" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blockChatFolderJoins" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blockInvitedBots" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blockMissingUsername" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maxNameLength" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "blockedNamePatterns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "checkExistingMembers" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GlobalContentSettings"
  ADD COLUMN "welcomeButtons" JSONB NOT NULL DEFAULT '[]';
