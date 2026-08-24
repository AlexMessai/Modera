-- Keep the existing detector columns intact and add only the UX/runtime
-- outcome profile introduced by the Automod rule modals.
ALTER TABLE "ChatModerationSettings"
  ADD COLUMN "linkEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ruleActions" JSONB NOT NULL DEFAULT '[]';

-- Existing chats that configured a non-pass-through link mode already had
-- link protection enabled implicitly. Preserve that behavior after the
-- enable switch becomes explicit.
UPDATE "ChatModerationSettings"
SET "linkEnabled" = true
WHERE "linkProtectionMode" <> 'ALLOW_ALL';
