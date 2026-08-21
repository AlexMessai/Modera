-- Replaces the single blockLinks boolean + allowlist-only behavior with 4
-- explicit modes (BOT_PRODUCT_SPEC_FINAL_UPDATED.md §22: Allow all / Block
-- all / Whitelist only / Blacklist only) and a real blacklist domain list.
-- blockLinks stays in place (unread by app code from this release), and
-- every existing row's current behavior is preserved exactly: blockLinks=
-- true meant "block unless on the allowlist", i.e. WHITELIST_ONLY; false
-- meant no link checking at all, i.e. ALLOW_ALL.
ALTER TABLE "ChatModerationSettings" ADD COLUMN "linkProtectionMode" TEXT NOT NULL DEFAULT 'ALLOW_ALL';
ALTER TABLE "ChatModerationSettings" ADD COLUMN "blockedDomains" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "GlobalModerationSettings" ADD COLUMN "linkProtectionMode" TEXT NOT NULL DEFAULT 'ALLOW_ALL';
ALTER TABLE "GlobalModerationSettings" ADD COLUMN "blockedDomains" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "ChatModerationSettings" SET "linkProtectionMode" = CASE WHEN "blockLinks" THEN 'WHITELIST_ONLY' ELSE 'ALLOW_ALL' END;
UPDATE "GlobalModerationSettings" SET "linkProtectionMode" = CASE WHEN "blockLinks" THEN 'WHITELIST_ONLY' ELSE 'ALLOW_ALL' END;
