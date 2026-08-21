-- Optional per-chat log channel (BOT_PRODUCT_SPEC §38): forwards moderation
-- events to a separate Telegram channel/group. Chat-only, no global default.
CREATE TABLE "ChatLogChannelSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "logChannelTelegramId" BIGINT,
  "logChannelTitle" TEXT,
  "pendingLinkAdminId" UUID,
  "pendingLinkExpiresAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatLogChannelSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatLogChannelSettings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatLogChannelSettings_chatId_key" ON "ChatLogChannelSettings"("chatId");
