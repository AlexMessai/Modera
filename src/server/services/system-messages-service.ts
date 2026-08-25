import { prisma } from "@/server/db/prisma";
import { DEFAULT_MODERATION_SETTINGS } from "@/server/services/global-moderation-service";
import { DEFAULT_APPEAL_MESSAGES, type AppealMessagesValue } from "@/server/services/appeal-notification-service";

const GLOBAL_ID = "global";

export type AutomodMessagesValue = {
  escalationMuteMessageTemplate: string;
  escalationBanMessageTemplate: string;
};

export type SystemMessagesValue = {
  automod: AutomodMessagesValue;
  appeals: AppealMessagesValue;
};

const DEFAULT_AUTOMOD_MESSAGES: AutomodMessagesValue = {
  escalationMuteMessageTemplate: DEFAULT_MODERATION_SETTINGS.escalationMuteMessageTemplate,
  escalationBanMessageTemplate: DEFAULT_MODERATION_SETTINGS.escalationBanMessageTemplate
};

export const DEFAULT_SYSTEM_MESSAGES: SystemMessagesValue = {
  automod: DEFAULT_AUTOMOD_MESSAGES,
  appeals: DEFAULT_APPEAL_MESSAGES
};

function normalizeTemplate(value: string, fallback: string, maxLength = 1000) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

export async function getSystemMessages(): Promise<SystemMessagesValue> {
  const [automod, appeals] = await Promise.all([
    prisma.globalModerationSettings.findUnique({
      where: { id: GLOBAL_ID },
      select: { escalationMuteMessageTemplate: true, escalationBanMessageTemplate: true }
    }),
    prisma.globalAppealSettings.findUnique({
      where: { id: GLOBAL_ID },
      select: {
        appealSubmittedMessageTemplate: true,
        appealNotifyAdminsMessageTemplate: true,
        appealApprovedMessageTemplate: true,
        appealRejectedMessageTemplate: true
      }
    })
  ]);

  return {
    automod: {
      escalationMuteMessageTemplate: automod?.escalationMuteMessageTemplate ?? DEFAULT_AUTOMOD_MESSAGES.escalationMuteMessageTemplate,
      escalationBanMessageTemplate: automod?.escalationBanMessageTemplate ?? DEFAULT_AUTOMOD_MESSAGES.escalationBanMessageTemplate
    },
    appeals: appeals ?? DEFAULT_APPEAL_MESSAGES
  };
}

export async function updateSystemMessages(input: {
  actingAdminId: string;
  automod: AutomodMessagesValue;
  appeals: AppealMessagesValue;
}): Promise<SystemMessagesValue> {
  const automod = {
    escalationMuteMessageTemplate: normalizeTemplate(input.automod.escalationMuteMessageTemplate, DEFAULT_AUTOMOD_MESSAGES.escalationMuteMessageTemplate),
    escalationBanMessageTemplate: normalizeTemplate(input.automod.escalationBanMessageTemplate, DEFAULT_AUTOMOD_MESSAGES.escalationBanMessageTemplate)
  };
  const appeals: AppealMessagesValue = {
    appealSubmittedMessageTemplate: normalizeTemplate(input.appeals.appealSubmittedMessageTemplate, DEFAULT_APPEAL_MESSAGES.appealSubmittedMessageTemplate),
    appealNotifyAdminsMessageTemplate: normalizeTemplate(input.appeals.appealNotifyAdminsMessageTemplate, DEFAULT_APPEAL_MESSAGES.appealNotifyAdminsMessageTemplate),
    appealApprovedMessageTemplate: normalizeTemplate(input.appeals.appealApprovedMessageTemplate, DEFAULT_APPEAL_MESSAGES.appealApprovedMessageTemplate),
    appealRejectedMessageTemplate: normalizeTemplate(input.appeals.appealRejectedMessageTemplate, DEFAULT_APPEAL_MESSAGES.appealRejectedMessageTemplate)
  };

  await prisma.$transaction(async (tx) => {
    await tx.globalModerationSettings.upsert({
      where: { id: GLOBAL_ID },
      create: { id: GLOBAL_ID, ...automod },
      update: automod
    });
    await tx.globalAppealSettings.upsert({
      where: { id: GLOBAL_ID },
      create: { id: GLOBAL_ID, ...appeals },
      update: appeals
    });

    await tx.auditLog.createMany({
      data: [
        { actingAdminId: input.actingAdminId, source: "ADMIN", action: "GLOBAL_AUTOMOD_SETTINGS_UPDATED", metadata: automod },
        { actingAdminId: input.actingAdminId, source: "ADMIN", action: "GLOBAL_APPEAL_SETTINGS_UPDATED", metadata: appeals }
      ]
    });
  });

  return { automod, appeals };
}
