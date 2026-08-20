-- Reverting the Bot API 10.1 "Join Request Queries" / guard_bot / Mini App
-- experiment (#56, #58, #59, #60) — the server-side API accepted every call
-- correctly but the Telegram client never rendered anything for the
-- applicant, and the user asked to drop the whole idea and go back to plain
-- captcha + the manual "Заявки" review queue.
DROP INDEX "JoinRequest_queryId_key";
ALTER TABLE "JoinRequest" DROP COLUMN "queryId";
