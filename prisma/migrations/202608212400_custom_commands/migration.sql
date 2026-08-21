-- Custom Commands (§41, Phase 10): admin-defined /commands with a canned
-- text response. Chat-only, no global default -- see schema.prisma's model comment.
CREATE TABLE "CustomCommand" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "trigger" VARCHAR(32) NOT NULL,
  "responseText" VARCHAR(1000) NOT NULL,
  "adminOnly" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CustomCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomCommand_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomCommand_chatId_trigger_key" ON "CustomCommand"("chatId", "trigger");
CREATE INDEX "CustomCommand_chatId_enabled_idx" ON "CustomCommand"("chatId", "enabled");
