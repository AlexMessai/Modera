CREATE TYPE "AntiRaidMode" AS ENUM ('ALERT', 'MUTE_NEW_MEMBERS');
CREATE TYPE "RaidIncidentStatus" AS ENUM ('ACTIVE', 'ENDED');

CREATE TABLE "ChatAntiRaidSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "useGlobalProfile" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "joinThreshold" INTEGER NOT NULL DEFAULT 10,
  "windowSeconds" INTEGER NOT NULL DEFAULT 60,
  "protectionDurationMinutes" INTEGER NOT NULL DEFAULT 30,
  "mode" "AntiRaidMode" NOT NULL DEFAULT 'ALERT',
  "newMemberMuteMinutes" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatAntiRaidSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatAntiRaidSettings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAntiRaidSettings_joinThreshold_check" CHECK ("joinThreshold" BETWEEN 3 AND 500),
  CONSTRAINT "ChatAntiRaidSettings_windowSeconds_check" CHECK ("windowSeconds" BETWEEN 10 AND 600),
  CONSTRAINT "ChatAntiRaidSettings_protectionDurationMinutes_check" CHECK ("protectionDurationMinutes" BETWEEN 1 AND 1440),
  CONSTRAINT "ChatAntiRaidSettings_newMemberMuteMinutes_check" CHECK ("newMemberMuteMinutes" BETWEEN 1 AND 10080)
);

CREATE UNIQUE INDEX "ChatAntiRaidSettings_chatId_key" ON "ChatAntiRaidSettings"("chatId");

CREATE TABLE "GlobalAntiRaidSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "joinThreshold" INTEGER NOT NULL DEFAULT 10,
  "windowSeconds" INTEGER NOT NULL DEFAULT 60,
  "protectionDurationMinutes" INTEGER NOT NULL DEFAULT 30,
  "mode" "AntiRaidMode" NOT NULL DEFAULT 'ALERT',
  "newMemberMuteMinutes" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GlobalAntiRaidSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GlobalAntiRaidSettings_joinThreshold_check" CHECK ("joinThreshold" BETWEEN 3 AND 500),
  CONSTRAINT "GlobalAntiRaidSettings_windowSeconds_check" CHECK ("windowSeconds" BETWEEN 10 AND 600),
  CONSTRAINT "GlobalAntiRaidSettings_protectionDurationMinutes_check" CHECK ("protectionDurationMinutes" BETWEEN 1 AND 1440),
  CONSTRAINT "GlobalAntiRaidSettings_newMemberMuteMinutes_check" CHECK ("newMemberMuteMinutes" BETWEEN 1 AND 10080)
);

CREATE TABLE "RaidIncident" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "status" "RaidIncidentStatus" NOT NULL DEFAULT 'ACTIVE',
  "mode" "AntiRaidMode" NOT NULL,
  "triggeredBy" VARCHAR(50) NOT NULL,
  "signalCount" INTEGER NOT NULL,
  "joinRequestCount" INTEGER NOT NULL,
  "joinCount" INTEGER NOT NULL,
  "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "activeUntil" TIMESTAMPTZ(3) NOT NULL,
  "endedAt" TIMESTAMPTZ(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RaidIncident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RaidIncident_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RaidIncident_chatId_status_startedAt_idx" ON "RaidIncident"("chatId", "status", "startedAt" DESC);
CREATE INDEX "RaidIncident_status_activeUntil_idx" ON "RaidIncident"("status", "activeUntil");
CREATE UNIQUE INDEX "RaidIncident_one_active_per_chat" ON "RaidIncident"("chatId") WHERE "status" = 'ACTIVE';