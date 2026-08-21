-- Silence Mode (§28): one row per chat, present only while active.
CREATE TABLE "ChatSilenceState" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3),
  "previousPermissions" JSONB,
  "startedByTelegramUserId" BIGINT,
  "startedByDisplayName" TEXT,
  CONSTRAINT "ChatSilenceState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatSilenceState_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatSilenceState_chatId_key" ON "ChatSilenceState"("chatId");
