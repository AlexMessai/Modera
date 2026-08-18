CREATE TYPE "ModerationActionType" AS ENUM ('WARNING', 'MUTE', 'UNMUTE', 'BAN', 'UNBAN');
CREATE TYPE "ModerationActionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "ModerationAction" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "affectedUserId" UUID NOT NULL,
  "actingAdminId" UUID NOT NULL,
  "type" "ModerationActionType" NOT NULL,
  "status" "ModerationActionStatus" NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(500),
  "expiresAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "telegramError" VARCHAR(500),
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationAction_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE,
  CONSTRAINT "ModerationAction_affectedUserId_fkey" FOREIGN KEY ("affectedUserId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE,
  CONSTRAINT "ModerationAction_actingAdminId_fkey" FOREIGN KEY ("actingAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT
);

CREATE INDEX "ModerationAction_chatId_createdAt_idx" ON "ModerationAction"("chatId", "createdAt" DESC);
CREATE INDEX "ModerationAction_affectedUserId_createdAt_idx" ON "ModerationAction"("affectedUserId", "createdAt" DESC);
CREATE INDEX "ModerationAction_actingAdminId_createdAt_idx" ON "ModerationAction"("actingAdminId", "createdAt" DESC);
CREATE INDEX "ModerationAction_status_createdAt_idx" ON "ModerationAction"("status", "createdAt" DESC);
CREATE INDEX "ModerationAction_type_createdAt_idx" ON "ModerationAction"("type", "createdAt" DESC);
