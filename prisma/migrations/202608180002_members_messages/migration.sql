ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'PENDING';

CREATE TABLE "Message" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "senderUserId" UUID,
  "telegramMessageId" BIGINT NOT NULL,
  "telegramDate" TIMESTAMPTZ(3) NOT NULL,
  "editedAt" TIMESTAMPTZ(3),
  "text" TEXT,
  "caption" TEXT,
  "messageType" TEXT NOT NULL,
  "isEdited" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE,
  CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "TelegramUser"("id") ON DELETE SET NULL,
  CONSTRAINT "Message_chatId_telegramMessageId_key" UNIQUE ("chatId", "telegramMessageId")
);

CREATE INDEX "ChatMember_status_lastSeenAt_idx" ON "ChatMember"("status", "lastSeenAt" DESC);
CREATE INDEX "TelegramUser_displayName_trgm_idx" ON "TelegramUser" USING GIN ("displayName" gin_trgm_ops);
CREATE INDEX "TelegramUser_username_trgm_idx" ON "TelegramUser" USING GIN ("username" gin_trgm_ops);
CREATE INDEX "Message_chatId_telegramDate_idx" ON "Message"("chatId", "telegramDate" DESC);
CREATE INDEX "Message_senderUserId_telegramDate_idx" ON "Message"("senderUserId", "telegramDate" DESC);
