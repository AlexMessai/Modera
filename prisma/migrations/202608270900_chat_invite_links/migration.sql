CREATE TABLE "ChatInviteLink" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "telegramInviteLink" TEXT NOT NULL,
  "name" TEXT,
  "memberLimit" INTEGER,
  "expiresAt" TIMESTAMPTZ(3),
  "createsJoinRequest" BOOLEAN NOT NULL DEFAULT false,
  "isRevoked" BOOLEAN NOT NULL DEFAULT false,
  "joinedCount" INTEGER NOT NULL DEFAULT 0,
  "leftCount" INTEGER NOT NULL DEFAULT 0,
  "createdByAdminId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatInviteLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatInviteLink_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatInviteLink_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatInviteLink_telegramInviteLink_key" ON "ChatInviteLink"("telegramInviteLink");
CREATE INDEX "ChatInviteLink_chatId_idx" ON "ChatInviteLink"("chatId");

ALTER TABLE "ChatMember" ADD COLUMN "joinedViaInviteLinkId" UUID;

ALTER TABLE "ChatMember"
  ADD CONSTRAINT "ChatMember_joinedViaInviteLinkId_fkey"
    FOREIGN KEY ("joinedViaInviteLinkId") REFERENCES "ChatInviteLink"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ChatMember_joinedViaInviteLinkId_idx" ON "ChatMember"("joinedViaInviteLinkId");
