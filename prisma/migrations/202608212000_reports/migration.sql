-- Reports (BOT_PRODUCT_SPEC §32, Phase 7): a member reply-reports another
-- member's message; moderators resolve it via a private Telegram card.
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

CREATE TABLE "Report" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "reporterUserId" UUID NOT NULL,
  "reportedUserId" UUID NOT NULL,
  "messageTelegramId" BIGINT,
  "reason" VARCHAR(500),
  "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
  "resolutionAction" TEXT,
  "resolvedByAdminId" UUID,
  "resolvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Report_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Report_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Report_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Report_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt" DESC);
CREATE INDEX "Report_chatId_status_createdAt_idx" ON "Report"("chatId", "status", "createdAt" DESC);
CREATE INDEX "Report_reportedUserId_createdAt_idx" ON "Report"("reportedUserId", "createdAt" DESC);
