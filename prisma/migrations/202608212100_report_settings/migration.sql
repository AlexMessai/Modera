-- Report settings (BOT_PRODUCT_SPEC §45's "Жалобы" section): whether
-- /report is enabled per chat, and the fixed duration used by the report
-- card's "Ограничить" quick action (previously hardcoded in report-service.ts).
CREATE TABLE "ChatReportSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "useGlobalProfile" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "muteDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatReportSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatReportSettings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatReportSettings_chatId_key" ON "ChatReportSettings"("chatId");

CREATE TABLE "GlobalReportSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "muteDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GlobalReportSettings_pkey" PRIMARY KEY ("id")
);
