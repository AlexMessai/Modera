-- Anti-Raid, rebuilt from scratch against the current schema (the previous
-- implementation was fully removed in #44 for unrelated panel-simplification
-- reasons, not a technical failure — see project notes). BOT_PRODUCT_SPEC
-- §26-27: mass-join detection with mitigation, auto-resolving once activity
-- subsides.
CREATE TABLE "ChatAntiRaidSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "useGlobalProfile" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "joinThreshold" INTEGER NOT NULL DEFAULT 30,
  "windowSeconds" INTEGER NOT NULL DEFAULT 20,
  "cooldownMinutes" INTEGER NOT NULL DEFAULT 15,
  "forceCaptcha" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatAntiRaidSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatAntiRaidSettings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatAntiRaidSettings_chatId_key" ON "ChatAntiRaidSettings"("chatId");

CREATE TABLE "GlobalAntiRaidSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "joinThreshold" INTEGER NOT NULL DEFAULT 30,
  "windowSeconds" INTEGER NOT NULL DEFAULT 20,
  "cooldownMinutes" INTEGER NOT NULL DEFAULT 15,
  "forceCaptcha" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GlobalAntiRaidSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RaidIncident" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastJoinAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  "peakJoinCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "RaidIncident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RaidIncident_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RaidIncident_chatId_status_idx" ON "RaidIncident"("chatId", "status");
