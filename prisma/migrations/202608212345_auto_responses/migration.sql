-- Auto Responses (§42, Phase 10): keyword/phrase-triggered automatic
-- replies. Chat-only, no global default -- see schema.prisma's model comment.
CREATE TYPE "AutoResponseMatch" AS ENUM ('CONTAINS', 'EXACT');

CREATE TABLE "AutoResponseRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "trigger" VARCHAR(200) NOT NULL,
  "matchType" "AutoResponseMatch" NOT NULL DEFAULT 'CONTAINS',
  "responseText" VARCHAR(1000) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AutoResponseRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutoResponseRule_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AutoResponseRule_chatId_enabled_idx" ON "AutoResponseRule"("chatId", "enabled");
