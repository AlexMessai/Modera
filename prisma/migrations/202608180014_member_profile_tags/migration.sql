ALTER TABLE "TelegramUser"
ADD COLUMN "isPremium" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "addedToAttachmentMenu" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "ChatMember"
ADD COLUMN "telegramCustomTitle" VARCHAR(16);

CREATE TABLE "chat_member_tags" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chat_member_id" UUID NOT NULL UNIQUE,
  "tag" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_member_tags_chat_member_id_fkey"
    FOREIGN KEY ("chat_member_id") REFERENCES "ChatMember"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
