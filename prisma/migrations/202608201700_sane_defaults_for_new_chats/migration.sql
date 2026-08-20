-- "Add and forget": a chat that never had its settings touched used to fall
-- back to everything-off, even if the owner had already configured a global
-- policy — ChatModerationSettings/ChatCaptchaSettings.useGlobalProfile
-- defaulted to false, so an unconfigured chat silently ignored the global
-- profile instead of inheriting it (the same bug ChatManualModerationSettings
-- had before it was fixed to default to true).
ALTER TABLE "ChatModerationSettings" ALTER COLUMN "useGlobalProfile" SET DEFAULT true;
ALTER TABLE "ChatCaptchaSettings" ALTER COLUMN "useGlobalProfile" SET DEFAULT true;

-- Seed a protective baseline global profile, but only if the owner hasn't
-- already saved one — never overwrite an explicit choice.
INSERT INTO "GlobalModerationSettings" (
  "id", "spamEnabled", "duplicateEnabled", "massMentionsEnabled",
  "autoEscalationEnabled", "updatedAt"
) VALUES (
  'global', true, true, true, true, CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "GlobalCaptchaSettings" ("id", "enabled", "updatedAt")
VALUES ('global', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
