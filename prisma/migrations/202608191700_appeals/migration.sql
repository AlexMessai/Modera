CREATE TYPE "AppealStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "Appeal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "moderationActionId" UUID NOT NULL,
  "status" "AppealStatus" NOT NULL DEFAULT 'PENDING',
  "message" VARCHAR(2000) NOT NULL,
  "resolvedByAdminId" UUID,
  "resolutionComment" VARCHAR(1000),
  "resolvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Appeal_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Appeal_moderationActionId_fkey" FOREIGN KEY ("moderationActionId") REFERENCES "ModerationAction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Appeal_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Appeal_moderationActionId_key" ON "Appeal"("moderationActionId");
CREATE INDEX "Appeal_status_createdAt_idx" ON "Appeal"("status", "createdAt" DESC);
CREATE INDEX "Appeal_chatId_status_createdAt_idx" ON "Appeal"("chatId", "status", "createdAt" DESC);
CREATE INDEX "Appeal_userId_createdAt_idx" ON "Appeal"("userId", "createdAt" DESC);
