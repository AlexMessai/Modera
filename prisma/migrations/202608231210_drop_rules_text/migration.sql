-- The /rules bot command and its per-chat/global rules text have been
-- removed entirely (product decision) -- no data worth preserving.
ALTER TABLE "ChatContentSettings" DROP COLUMN "rulesText";
ALTER TABLE "GlobalContentSettings" DROP COLUMN "rulesText";
