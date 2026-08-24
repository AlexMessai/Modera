-- Warnings become first-class lifecycle records instead of relying only on
-- ChatMember.warningCount. All changes are additive; the counter remains as
-- a denormalized cache for existing UI and compatibility.
ALTER TABLE "ModerationAction"
  ADD COLUMN "revokedAt" TIMESTAMPTZ(3),
  ADD COLUMN "revokedByAdminId" UUID,
  ADD COLUMN "revocationReason" VARCHAR(500),
  ADD COLUMN "triggeredPunishmentActionId" UUID;

ALTER TABLE "ModerationAction"
  ADD CONSTRAINT "ModerationAction_revokedByAdminId_fkey"
    FOREIGN KEY ("revokedByAdminId") REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ModerationAction_triggeredPunishmentActionId_fkey"
    FOREIGN KEY ("triggeredPunishmentActionId") REFERENCES "ModerationAction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ModerationAction_triggeredPunishmentActionId_key"
  ON "ModerationAction"("triggeredPunishmentActionId");
CREATE INDEX "ModerationAction_chatId_affectedUserId_type_revokedAt_createdAt_idx"
  ON "ModerationAction"("chatId", "affectedUserId", "type", "revokedAt", "createdAt" DESC);
CREATE INDEX "ModerationAction_revokedByAdminId_revokedAt_idx"
  ON "ModerationAction"("revokedByAdminId", "revokedAt" DESC);

-- Previous /unwarn and approved-warning-appeal code decremented only the
-- member counter. When there are more WARNING records than the counter says,
-- treat the newest excess records as already revoked. This preserves the
-- effective state users saw before the lifecycle columns existed.
WITH ranked_warnings AS (
  SELECT
    ma."id",
    cm."warningCount",
    COUNT(*) OVER (
      PARTITION BY ma."chatId", ma."affectedUserId"
    )::int AS "recordCount",
    ROW_NUMBER() OVER (
      PARTITION BY ma."chatId", ma."affectedUserId"
      ORDER BY ma."createdAt" DESC, ma."id" DESC
    )::int AS "newestRank"
  FROM "ModerationAction" ma
  JOIN "ChatMember" cm
    ON cm."chatId" = ma."chatId"
   AND cm."userId" = ma."affectedUserId"
  WHERE ma."type" = 'WARNING'
    AND ma."status" = 'SUCCEEDED'
)
UPDATE "ModerationAction" ma
SET
  "revokedAt" = CURRENT_TIMESTAMP,
  "revocationReason" = 'Восстановлено из прежнего счётчика после /unwarn или апелляции.',
  "updatedAt" = CURRENT_TIMESTAMP
FROM ranked_warnings ranked
WHERE ma."id" = ranked."id"
  AND ranked."newestRank" <= GREATEST(ranked."recordCount" - ranked."warningCount", 0);

-- Older installations may have a positive warning counter without the same
-- number of WARNING actions. Preserve that state as explicit legacy records
-- so active-warning reads can switch to entities immediately and safely.
WITH warning_counts AS (
  SELECT
    cm."id" AS "membershipId",
    cm."chatId",
    cm."userId",
    cm."warningCount",
    COALESCE(existing."recordCount", 0) AS "recordCount",
    COALESCE(cm."lastModerationAt", cm."updatedAt", CURRENT_TIMESTAMP) AS "recordedAt"
  FROM "ChatMember" cm
  LEFT JOIN (
    SELECT "chatId", "affectedUserId", COUNT(*)::int AS "recordCount"
    FROM "ModerationAction"
    WHERE "type" = 'WARNING'
      AND "status" = 'SUCCEEDED'
      AND "revokedAt" IS NULL
    GROUP BY "chatId", "affectedUserId"
  ) existing
    ON existing."chatId" = cm."chatId"
   AND existing."affectedUserId" = cm."userId"
  WHERE cm."warningCount" > COALESCE(existing."recordCount", 0)
)
INSERT INTO "ModerationAction" (
  "chatId", "affectedUserId", "source", "type", "status", "reason",
  "completedAt", "metadata", "createdAt", "updatedAt"
)
SELECT
  wc."chatId",
  wc."userId",
  'SYSTEM'::"AuditSource",
  'WARNING'::"ModerationActionType",
  'SUCCEEDED'::"ModerationActionStatus",
  'Предупреждение перенесено из прежнего счётчика.',
  wc."recordedAt",
  jsonb_build_object(
    'legacyBackfill', true,
    'legacyMembershipId', wc."membershipId",
    'legacySequence', generated.sequence
  ),
  wc."recordedAt",
  wc."recordedAt"
FROM warning_counts wc
CROSS JOIN LATERAL generate_series(
  1,
  GREATEST(wc."warningCount" - wc."recordCount", 0)
) AS generated(sequence);
