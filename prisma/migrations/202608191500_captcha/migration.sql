CREATE TYPE "CaptchaFailAction" AS ENUM ('KICK', 'BAN');

CREATE TABLE "ChatCaptchaSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "useGlobalProfile" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "timeoutMinutes" INTEGER NOT NULL DEFAULT 5,
  "failAction" "CaptchaFailAction" NOT NULL DEFAULT 'KICK',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatCaptchaSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatCaptchaSettings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatCaptchaSettings_timeoutMinutes_check" CHECK ("timeoutMinutes" BETWEEN 1 AND 1440)
);

CREATE UNIQUE INDEX "ChatCaptchaSettings_chatId_key" ON "ChatCaptchaSettings"("chatId");

CREATE TABLE "GlobalCaptchaSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "timeoutMinutes" INTEGER NOT NULL DEFAULT 5,
  "failAction" "CaptchaFailAction" NOT NULL DEFAULT 'KICK',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GlobalCaptchaSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GlobalCaptchaSettings_timeoutMinutes_check" CHECK ("timeoutMinutes" BETWEEN 1 AND 1440)
);
