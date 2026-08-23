-- Chat-scoped self-service Telegram login + "Команда" tab. Additive: existing
-- GLOBAL email/password AdminUser rows and behavior are unchanged (scope
-- defaults to GLOBAL, email/passwordHash keep their values). See
-- chat-admin-access-service.ts.

CREATE TYPE "AdminScope" AS ENUM ('GLOBAL', 'CHAT');
CREATE TYPE "ChatAdminAccessRole" AS ENUM ('OWNER', 'ADMIN', 'MODERATOR');

-- A Telegram-only self-registered account has neither an email nor a
-- password. Drop NOT NULL on both, and replace the plain unique constraint
-- on "email" with a partial unique index so any number of NULL-email rows
-- can coexist alongside the still-unique real emails.
ALTER TABLE "AdminUser" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "AdminUser" ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TABLE "AdminUser" DROP CONSTRAINT "AdminUser_email_key";
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email") WHERE "email" IS NOT NULL;

ALTER TABLE "AdminUser" ADD COLUMN "scope" "AdminScope" NOT NULL DEFAULT 'GLOBAL';
CREATE INDEX "AdminUser_scope_idx" ON "AdminUser"("scope");

CREATE TABLE "ChatAdminAccess" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatId"           UUID NOT NULL,
  "adminId"          UUID NOT NULL,
  "role"             "ChatAdminAccessRole" NOT NULL DEFAULT 'ADMIN',
  "grantedVia"       TEXT NOT NULL,
  "grantedByAdminId" UUID,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAdminAccess_chatId_fkey"
    FOREIGN KEY ("chatId") REFERENCES "Chat"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAdminAccess_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatAdminAccess_grantedByAdminId_fkey"
    FOREIGN KEY ("grantedByAdminId") REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatAdminAccess_chatId_adminId_key" ON "ChatAdminAccess"("chatId", "adminId");
CREATE INDEX "ChatAdminAccess_adminId_idx" ON "ChatAdminAccess"("adminId");
CREATE INDEX "ChatAdminAccess_chatId_idx" ON "ChatAdminAccess"("chatId");
