CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

CREATE TABLE "JoinRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "telegramUpdateId" BIGINT NOT NULL,
  "userChatId" BIGINT,
  "bio" VARCHAR(500),
  "inviteLink" TEXT,
  "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMPTZ(3) NOT NULL,
  "processingAt" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedByAdminId" UUID,
  "telegramError" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JoinRequest_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JoinRequest_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "JoinRequest_telegramUpdateId_key" ON "JoinRequest"("telegramUpdateId");
CREATE INDEX "JoinRequest_status_requestedAt_idx" ON "JoinRequest"("status", "requestedAt" DESC);
CREATE INDEX "JoinRequest_chatId_status_requestedAt_idx" ON "JoinRequest"("chatId", "status", "requestedAt" DESC);
CREATE INDEX "JoinRequest_userId_requestedAt_idx" ON "JoinRequest"("userId", "requestedAt" DESC);
CREATE INDEX "JoinRequest_processingAt_idx" ON "JoinRequest"("processingAt");