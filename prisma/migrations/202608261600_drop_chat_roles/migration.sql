-- Roles turned out to have no purpose the user actually wanted: they never
-- gated anything in the web panel (that's ChatAdminAccess), and the only
-- real effect was authorizing in-Telegram moderation commands and the
-- /settings bot menu's "Роли" section. User's explicit call: remove them
-- entirely and fall back to a plain live-Telegram-admin check for those
-- commands (isLiveTelegramChatAdmin), same as before Phase 1b introduced
-- ChatRole-based authorization.
ALTER TABLE "ChatMember" DROP CONSTRAINT "ChatMember_chatRoleId_fkey";
DROP INDEX "ChatMember_chatRoleId_idx";
ALTER TABLE "ChatMember" DROP COLUMN "chatRoleId";
ALTER TABLE "ChatMember" DROP COLUMN "chatRoleAssignedBy";

DROP TABLE "ChatRole";
