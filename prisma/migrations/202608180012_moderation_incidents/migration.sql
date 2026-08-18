CREATE TYPE "IncidentStatus" AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED', 'SKIPPED', 'AUTO_RESOLVED');

CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "ModerationIncident" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chatId" UUID NOT NULL,
    "affectedUserId" UUID NOT NULL,
    "messageId" UUID,
    "assignedAdminId" UUID,
    "resolvedByAdminId" UUID,
    "type" VARCHAR(50) NOT NULL,
    "rule" VARCHAR(100),
    "status" "IncidentStatus" NOT NULL DEFAULT 'NEW',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "reason" VARCHAR(500) NOT NULL,
    "moderatorNote" VARCHAR(1000),
    "previousViolationCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "reviewedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ModerationIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModerationIncident_messageId_rule_key" ON "ModerationIncident"("messageId", "rule");
CREATE INDEX "ModerationIncident_status_severity_createdAt_idx" ON "ModerationIncident"("status", "severity", "createdAt" DESC);
CREATE INDEX "ModerationIncident_chatId_status_createdAt_idx" ON "ModerationIncident"("chatId", "status", "createdAt" DESC);
CREATE INDEX "ModerationIncident_affectedUserId_createdAt_idx" ON "ModerationIncident"("affectedUserId", "createdAt" DESC);
CREATE INDEX "ModerationIncident_messageId_idx" ON "ModerationIncident"("messageId");

ALTER TABLE "ModerationIncident" ADD CONSTRAINT "ModerationIncident_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationIncident" ADD CONSTRAINT "ModerationIncident_affectedUserId_fkey" FOREIGN KEY ("affectedUserId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationIncident" ADD CONSTRAINT "ModerationIncident_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationIncident" ADD CONSTRAINT "ModerationIncident_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationIncident" ADD CONSTRAINT "ModerationIncident_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
