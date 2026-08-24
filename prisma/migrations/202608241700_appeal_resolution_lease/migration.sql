-- A short-lived resolution lease prevents two admins (web or Telegram)
-- from reverting the same punishment concurrently. Existing pending appeals
-- remain immediately claimable because both columns default to NULL.
ALTER TABLE "Appeal"
  ADD COLUMN "resolutionAttemptId" UUID,
  ADD COLUMN "resolutionStartedAt" TIMESTAMPTZ(3);

CREATE INDEX "Appeal_status_resolutionStartedAt_idx"
  ON "Appeal"("status", "resolutionStartedAt");
