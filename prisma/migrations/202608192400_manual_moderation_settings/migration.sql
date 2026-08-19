CREATE TABLE "ChatManualModerationSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "useGlobalProfile" BOOLEAN NOT NULL DEFAULT false,
  "warnMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '⚠️ %target% получил(а) предупреждение. %reason%',
  "warnDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  "warnDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  "muteMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '🔇 %target% получил(а) mute на %duration%. %reason%',
  "muteDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  "muteDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  "banMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '⛔ %target% заблокирован(а). %reason%',
  "banDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  "banDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  "unbanMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '✅ С %target% снята блокировка.',
  "unbanDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  "unbanDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatManualModerationSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatManualModerationSettings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatManualModerationSettings_chatId_key" ON "ChatManualModerationSettings"("chatId");

CREATE TABLE "GlobalManualModerationSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "warnMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '⚠️ %target% получил(а) предупреждение. %reason%',
  "warnDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  "warnDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  "muteMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '🔇 %target% получил(а) mute на %duration%. %reason%',
  "muteDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  "muteDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  "banMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '⛔ %target% заблокирован(а). %reason%',
  "banDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  "banDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  "unbanMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT '✅ С %target% снята блокировка.',
  "unbanDeleteCommandMessage" BOOLEAN NOT NULL DEFAULT false,
  "unbanDeleteTargetMessage" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GlobalManualModerationSettings_pkey" PRIMARY KEY ("id")
);
