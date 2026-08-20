-- Bot API 10.1 "Join Request Queries": stores the query_id so the Mini App
-- confirmation flow (opened via sendChatJoinRequestWebApp) can look the
-- request back up once the applicant taps confirm inside it.
ALTER TABLE "JoinRequest" ADD COLUMN "queryId" TEXT;

CREATE UNIQUE INDEX "JoinRequest_queryId_key" ON "JoinRequest"("queryId");
