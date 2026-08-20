-- Lets an existing admin log in with the Telegram Login Widget instead of
-- email/password, once they've linked their Telegram account.
ALTER TABLE "AdminUser"
  ADD COLUMN "telegramUserId" BIGINT,
  ADD COLUMN "telegramUsername" TEXT,
  ADD COLUMN "telegramFirstName" TEXT;

CREATE UNIQUE INDEX "AdminUser_telegramUserId_key" ON "AdminUser"("telegramUserId");
