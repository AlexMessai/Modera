-- telegramUserId + its unique index already exist (202608201400_admin_telegram_login,
-- from the Telegram Login Widget). This just adds the /link <code> DM flow's
-- own columns on top of the same field.
ALTER TABLE "AdminUser"
  ADD COLUMN "telegramLinkCode" TEXT,
  ADD COLUMN "telegramLinkCodeExpiresAt" TIMESTAMPTZ(3);
