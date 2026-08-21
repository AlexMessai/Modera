-- Phase 1 (BOT_PRODUCT_SPEC_FINAL_UPDATED.md §33-35): per-chat permission
-- roles. Additive only — nothing in the bot's authorization path reads
-- ChatMember.chatRoleId yet (isLiveTelegramChatAdmin remains the actual
-- gate); this migration just lands the schema + lets chat-role-service.ts
-- start seeding/syncing roles ahead of the later switch-over, so roles are
-- already populated by the time enforcement moves to them.
CREATE TABLE "ChatRole" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "isCustom" BOOLEAN NOT NULL DEFAULT FALSE,
  "permissions" TEXT[] NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatRole_chatId_fkey"
    FOREIGN KEY ("chatId") REFERENCES "Chat"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatRole_chatId_key_key" ON "ChatRole"("chatId", "key");

ALTER TABLE "ChatMember"
  ADD COLUMN "chatRoleId" UUID,
  ADD COLUMN "chatRoleAssignedBy" TEXT;

ALTER TABLE "ChatMember"
  ADD CONSTRAINT "ChatMember_chatRoleId_fkey"
    FOREIGN KEY ("chatRoleId") REFERENCES "ChatRole"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ChatMember_chatRoleId_idx" ON "ChatMember"("chatRoleId");
