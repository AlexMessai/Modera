-- Simplify moderation notifications: drop the private DM sent at punishment
-- time (appeal-notification-service.ts::notifyPunishmentAppealOption no
-- longer sends one, only the ephemeral in-chat notice remains), which makes
-- /appeal's old Reply-to-DM matching (metadata.appealDmMessageId) physically
-- impossible. /appeal is redesigned to find the user's latest
-- appeal-eligible punishment automatically (same disambiguation pattern
-- /unmute already uses), gated per chat by the new ChatAppealSettings.enabled
-- toggle instead. GlobalManualModerationSettings.proactiveDmNotificationsEnabled
-- is dropped -- its only reader (the appeal-decision DM) now reads
-- ChatAppealSettings.notifyUserOnDecision, scoped per chat instead of
-- globally. GlobalAppealSettings holds the three appeal-flow texts that used
-- to be inline string literals, moved into the same editable-template system
-- every other moderation text already uses.

CREATE TABLE "ChatAppealSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notifyAdminsOnSubmit" BOOLEAN NOT NULL DEFAULT true,
  "notifyUserOnDecision" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatAppealSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatAppealSettings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatAppealSettings_chatId_key" ON "ChatAppealSettings"("chatId");

CREATE TABLE "GlobalAppealSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "appealSubmittedMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT 'Апелляция отправлена администраторам. Дождитесь решения.',
  "appealNotifyAdminsMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT 'Новая апелляция от %user% по чату «%chat%» (%action%):
%message%',
  "appealApprovedMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT 'Ваша апелляция по чату «%chat%» одобрена, наказание отменено.%comment%',
  "appealRejectedMessageTemplate" VARCHAR(1000) NOT NULL DEFAULT 'Ваша апелляция по чату «%chat%» отклонена.%comment%',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GlobalAppealSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GlobalManualModerationSettings" DROP COLUMN "proactiveDmNotificationsEnabled";
