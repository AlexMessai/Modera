CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN', 'MODERATOR', 'VIEWER');
CREATE TYPE "BotChatStatus" AS ENUM ('ACTIVE', 'CONNECTED', 'NOT_ADMIN', 'INSUFFICIENT_PERMISSIONS', 'REMOVED', 'DISABLED', 'TELEGRAM_ERROR');
CREATE TYPE "AuditSource" AS ENUM ('TELEGRAM', 'ADMIN', 'SYSTEM');
CREATE TYPE "MembershipStatus" AS ENUM ('CREATOR', 'ADMINISTRATOR', 'MEMBER', 'RESTRICTED', 'LEFT', 'BANNED', 'UNKNOWN');

CREATE TABLE "TelegramBot" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "telegramBotId" BIGINT NOT NULL UNIQUE,
  "username" TEXT,
  "firstName" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "lastCheckedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Chat" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "telegramChatId" BIGINT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "username" TEXT,
  "type" TEXT NOT NULL,
  "photoFileId" TEXT,
  "knownMemberCount" INTEGER,
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "BotChat" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "botId" UUID NOT NULL,
  "chatId" UUID NOT NULL,
  "telegramStatus" TEXT,
  "status" "BotChatStatus" NOT NULL DEFAULT 'CONNECTED',
  "permissions" JSONB,
  "lastError" TEXT,
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotChat_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TelegramBot"("id") ON DELETE CASCADE,
  CONSTRAINT "BotChat_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE,
  CONSTRAINT "BotChat_botId_chatId_key" UNIQUE ("botId", "chatId")
);

CREATE TABLE "TelegramUser" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "telegramUserId" BIGINT NOT NULL UNIQUE,
  "username" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT,
  "displayName" TEXT NOT NULL,
  "isBot" BOOLEAN NOT NULL DEFAULT FALSE,
  "languageCode" TEXT,
  "avatarFileId" TEXT,
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ChatMember" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'UNKNOWN',
  "internalRole" TEXT,
  "joinedAt" TIMESTAMPTZ(3),
  "leftAt" TIMESTAMPTZ(3),
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "punishmentState" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMember_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE,
  CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TelegramUser"("id") ON DELETE CASCADE,
  CONSTRAINT "ChatMember_chatId_userId_key" UNIQUE ("chatId", "userId")
);

CREATE TABLE "AdminUser" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL UNIQUE,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL DEFAULT 'VIEWER',
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "lastLoginAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AdminSession" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "adminId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE
);

CREATE TABLE "AuditLog" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatId" UUID,
  "affectedUserId" UUID,
  "actingAdminId" UUID,
  "source" "AuditSource" NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL,
  CONSTRAINT "AuditLog_affectedUserId_fkey" FOREIGN KEY ("affectedUserId") REFERENCES "TelegramUser"("id") ON DELETE SET NULL,
  CONSTRAINT "AuditLog_actingAdminId_fkey" FOREIGN KEY ("actingAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL
);

CREATE INDEX "TelegramBot_isActive_idx" ON "TelegramBot"("isActive");
CREATE INDEX "Chat_lastActivityAt_idx" ON "Chat"("lastActivityAt" DESC);
CREATE INDEX "Chat_type_idx" ON "Chat"("type");
CREATE INDEX "Chat_title_trgm_idx" ON "Chat" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Chat_username_trgm_idx" ON "Chat" USING GIN ("username" gin_trgm_ops);
CREATE INDEX "BotChat_chatId_status_idx" ON "BotChat"("chatId", "status");
CREATE INDEX "BotChat_botId_status_idx" ON "BotChat"("botId", "status");
CREATE INDEX "TelegramUser_username_idx" ON "TelegramUser"("username");
CREATE INDEX "TelegramUser_lastSeenAt_idx" ON "TelegramUser"("lastSeenAt" DESC);
CREATE INDEX "ChatMember_chatId_status_lastSeenAt_idx" ON "ChatMember"("chatId", "status", "lastSeenAt" DESC);
CREATE INDEX "ChatMember_userId_idx" ON "ChatMember"("userId");
CREATE INDEX "AdminUser_role_isActive_idx" ON "AdminUser"("role", "isActive");
CREATE INDEX "AdminSession_adminId_expiresAt_idx" ON "AdminSession"("adminId", "expiresAt");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);
CREATE INDEX "AuditLog_chatId_createdAt_idx" ON "AuditLog"("chatId", "createdAt" DESC);
CREATE INDEX "AuditLog_affectedUserId_createdAt_idx" ON "AuditLog"("affectedUserId", "createdAt" DESC);
CREATE INDEX "AuditLog_actingAdminId_createdAt_idx" ON "AuditLog"("actingAdminId", "createdAt" DESC);
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);
