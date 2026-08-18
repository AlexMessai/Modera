ALTER TABLE "ChatMember"
ADD COLUMN "lastAutoEscalationWarningCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "punishmentExpiresAt" TIMESTAMPTZ(3);

CREATE INDEX "ChatMember_punishmentState_punishmentExpiresAt_idx"
ON "ChatMember"("punishmentState", "punishmentExpiresAt");

ALTER TABLE "ChatModerationSettings"
ADD COLUMN "autoEscalationEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "muteAfterWarnings" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "muteDurationMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "banAfterWarnings" INTEGER NOT NULL DEFAULT 6,
ADD CONSTRAINT "ChatModerationSettings_muteAfterWarnings_check"
  CHECK ("muteAfterWarnings" BETWEEN 2 AND 20),
ADD CONSTRAINT "ChatModerationSettings_muteDurationMinutes_check"
  CHECK ("muteDurationMinutes" BETWEEN 1 AND 10080),
ADD CONSTRAINT "ChatModerationSettings_banAfterWarnings_check"
  CHECK ("banAfterWarnings" BETWEEN 3 AND 50 AND "banAfterWarnings" > "muteAfterWarnings");

ALTER TABLE "GlobalModerationSettings"
ADD COLUMN "autoEscalationEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "muteAfterWarnings" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "muteDurationMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "banAfterWarnings" INTEGER NOT NULL DEFAULT 6,
ADD CONSTRAINT "GlobalModerationSettings_muteAfterWarnings_check"
  CHECK ("muteAfterWarnings" BETWEEN 2 AND 20),
ADD CONSTRAINT "GlobalModerationSettings_muteDurationMinutes_check"
  CHECK ("muteDurationMinutes" BETWEEN 1 AND 10080),
ADD CONSTRAINT "GlobalModerationSettings_banAfterWarnings_check"
  CHECK ("banAfterWarnings" BETWEEN 3 AND 50 AND "banAfterWarnings" > "muteAfterWarnings");

ALTER TABLE "ModerationAction"
ALTER COLUMN "actingAdminId" DROP NOT NULL,
ADD COLUMN "source" "AuditSource" NOT NULL DEFAULT 'ADMIN';

CREATE INDEX "ModerationAction_source_status_createdAt_idx"
ON "ModerationAction"("source", "status", "createdAt" DESC);

CREATE INDEX "ModerationAction_expiresAt_status_idx"
ON "ModerationAction"("expiresAt", "status");