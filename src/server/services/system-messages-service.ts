import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_MEDIA_FILTERS,
  DEFAULT_MODERATION_SETTINGS,
  normalizeMediaFilters,
  type MediaFilterRuleValue
} from "@/server/services/global-moderation-service";
import { DEFAULT_CAPTCHA_SETTINGS } from "@/server/services/captcha-settings-service";
import { DEFAULT_CONTENT_SETTINGS } from "@/server/services/content-settings-service";
import { DEFAULT_APPEAL_MESSAGES, type AppealMessagesValue } from "@/server/services/appeal-notification-service";

const GLOBAL_ID = "global";

export type AutomodMessagesValue = {
  escalationMuteMessageTemplate: string;
  escalationBanMessageTemplate: string;
  mediaFilters: MediaFilterRuleValue[];
};

export type SystemMessagesValue = {
  automod: AutomodMessagesValue;
  captcha: { challengeMessageTemplate: string };
  content: { welcomeMessageTemplate: string };
  appeals: AppealMessagesValue;
};

const DEFAULT_AUTOMOD_MESSAGES: AutomodMessagesValue = {
  escalationMuteMessageTemplate: DEFAULT_MODERATION_SETTINGS.escalationMuteMessageTemplate,
  escalationBanMessageTemplate: DEFAULT_MODERATION_SETTINGS.escalationBanMessageTemplate,
  mediaFilters: DEFAULT_MEDIA_FILTERS
};

export const DEFAULT_SYSTEM_MESSAGES: SystemMessagesValue = {
  automod: DEFAULT_AUTOMOD_MESSAGES,
  captcha: { challengeMessageTemplate: DEFAULT_CAPTCHA_SETTINGS.challengeMessageTemplate },
  content: { welcomeMessageTemplate: DEFAULT_CONTENT_SETTINGS.welcomeMessageTemplate },
  appeals: DEFAULT_APPEAL_MESSAGES
};

function normalizeTemplate(value: string, fallback: string, maxLength = 1000) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

export async function getSystemMessages(): Promise<SystemMessagesValue> {
  const [automod, captcha, content, appeals] = await Promise.all([
    prisma.globalModerationSettings.findUnique({
      where: { id: GLOBAL_ID },
      select: { escalationMuteMessageTemplate: true, escalationBanMessageTemplate: true, mediaFilters: true }
    }),
    prisma.globalCaptchaSettings.findUnique({ where: { id: GLOBAL_ID }, select: { challengeMessageTemplate: true } }),
    prisma.globalContentSettings.findUnique({ where: { id: GLOBAL_ID }, select: { welcomeMessageTemplate: true } }),
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
      escalationBanMessageTemplate: automod?.escalationBanMessageTemplate ?? DEFAULT_AUTOMOD_MESSAGES.escalationBanMessageTemplate,
      mediaFilters: normalizeMediaFilters(automod?.mediaFilters ?? DEFAULT_MEDIA_FILTERS)
    },
    captcha: { challengeMessageTemplate: captcha?.challengeMessageTemplate ?? DEFAULT_SYSTEM_MESSAGES.captcha.challengeMessageTemplate },
    content: { welcomeMessageTemplate: content?.welcomeMessageTemplate ?? DEFAULT_SYSTEM_MESSAGES.content.welcomeMessageTemplate },
    appeals: appeals ?? DEFAULT_APPEAL_MESSAGES
  };
}

export async function updateSystemMessages(input: {
  actingAdminId: string;
  automod: AutomodMessagesValue;
  captcha: { challengeMessageTemplate: string };
  content: { welcomeMessageTemplate: string };
  appeals: AppealMessagesValue;
}): Promise<SystemMessagesValue> {
  const automod = {
    escalationMuteMessageTemplate: normalizeTemplate(input.automod.escalationMuteMessageTemplate, DEFAULT_AUTOMOD_MESSAGES.escalationMuteMessageTemplate),
    escalationBanMessageTemplate: normalizeTemplate(input.automod.escalationBanMessageTemplate, DEFAULT_AUTOMOD_MESSAGES.escalationBanMessageTemplate),
    mediaFilters: normalizeMediaFilters(input.automod.mediaFilters)
  };
  const captcha = { challengeMessageTemplate: normalizeTemplate(input.captcha.challengeMessageTemplate, DEFAULT_SYSTEM_MESSAGES.captcha.challengeMessageTemplate) };
  const content = { welcomeMessageTemplate: normalizeTemplate(input.content.welcomeMessageTemplate, DEFAULT_SYSTEM_MESSAGES.content.welcomeMessageTemplate, 2000) };
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
    await tx.globalCaptchaSettings.upsert({
      where: { id: GLOBAL_ID },
      create: { id: GLOBAL_ID, ...captcha },
      update: captcha
    });
    await tx.globalContentSettings.upsert({
      where: { id: GLOBAL_ID },
      create: { id: GLOBAL_ID, ...content },
      update: content
    });
    await tx.globalAppealSettings.upsert({
      where: { id: GLOBAL_ID },
      create: { id: GLOBAL_ID, ...appeals },
      update: appeals
    });

    await tx.auditLog.createMany({
      data: [
        { actingAdminId: input.actingAdminId, source: "ADMIN", action: "GLOBAL_AUTOMOD_SETTINGS_UPDATED", metadata: automod },
        { actingAdminId: input.actingAdminId, source: "ADMIN", action: "GLOBAL_CAPTCHA_SETTINGS_UPDATED", metadata: captcha },
        { actingAdminId: input.actingAdminId, source: "ADMIN", action: "GLOBAL_CONTENT_SETTINGS_UPDATED", metadata: content },
        { actingAdminId: input.actingAdminId, source: "ADMIN", action: "GLOBAL_APPEAL_SETTINGS_UPDATED", metadata: appeals }
      ]
    });
  });

  return { automod, captcha, content, appeals };
}
