import { prisma } from "@/server/db/prisma";
import { getModerationNotificationProfile, renderTelegramModerationNotification, type ModerationNotificationSource } from "@/server/services/moderation-notification-settings-service";
import { resolveEffectiveChatAppealSettings } from "@/server/services/chat-appeal-settings-service";
import { listTelegramModeratorsForChat } from "@/server/services/chat-admin-access-service";
import { getTelegramBotProfile, getTelegramClient } from "@/server/telegram/client";
import { escapeTelegramHtml, parseTelegramHtml } from "@/server/telegram/formatted-text";

const ACTION_LABELS: Record<string, string> = {
  WARNING: "предупреждение",
  MUTE: "временное ограничение (mute)",
  BAN: "блокировка (ban)"
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPEAL_CALLBACK_PREFIX = "appeal:";

export function buildAppealCallbackData(appealId: string, decision: "APPROVE" | "REJECT") {
  return `${APPEAL_CALLBACK_PREFIX}${appealId}:${decision}`;
}

export function parseAppealCallbackData(data: string): { appealId: string; decision: "APPROVE" | "REJECT" } | null {
  if (!data.startsWith(APPEAL_CALLBACK_PREFIX)) return null;
  const [appealId, decision] = data.slice(APPEAL_CALLBACK_PREFIX.length).split(":");
  if (!appealId || !UUID_PATTERN.test(appealId)) return null;
  if (decision !== "APPROVE" && decision !== "REJECT") return null;
  return { appealId, decision: decision as "APPROVE" | "REJECT" };
}

const GLOBAL_APPEAL_MESSAGES_ID = "global";

// The three appeal-flow texts that used to be inline string literals here
// and in update-handler.ts -- moved into the same editable-template system
// every other moderation text already uses (see system-messages-service.ts /
// system-messages-settings.tsx). Global-only, same as
// GlobalCaptchaSettings.challengeMessageTemplate -- no per-chat override.
export type AppealMessagesValue = {
  appealSubmittedMessageTemplate: string;
  appealNotifyAdminsMessageTemplate: string;
  appealApprovedMessageTemplate: string;
  appealRejectedMessageTemplate: string;
};

export const DEFAULT_APPEAL_MESSAGES: AppealMessagesValue = {
  appealSubmittedMessageTemplate: "Апелляция отправлена администраторам. Дождитесь решения.",
  appealNotifyAdminsMessageTemplate: "Новая апелляция от %user% по чату «%chat%» (%action%):\n%message%",
  appealApprovedMessageTemplate: "Ваша апелляция по чату «%chat%» одобрена, наказание отменено.%comment%",
  appealRejectedMessageTemplate: "Ваша апелляция по чату «%chat%» отклонена.%comment%"
};

export async function getAppealMessages(): Promise<AppealMessagesValue> {
  const stored = await prisma.globalAppealSettings.findUnique({
    where: { id: GLOBAL_APPEAL_MESSAGES_ID },
    select: {
      appealSubmittedMessageTemplate: true,
      appealNotifyAdminsMessageTemplate: true,
      appealApprovedMessageTemplate: true,
      appealRejectedMessageTemplate: true
    }
  });
  return {
    appealSubmittedMessageTemplate: stored?.appealSubmittedMessageTemplate ?? DEFAULT_APPEAL_MESSAGES.appealSubmittedMessageTemplate,
    appealNotifyAdminsMessageTemplate: stored?.appealNotifyAdminsMessageTemplate ?? DEFAULT_APPEAL_MESSAGES.appealNotifyAdminsMessageTemplate,
    appealApprovedMessageTemplate: stored?.appealApprovedMessageTemplate ?? DEFAULT_APPEAL_MESSAGES.appealApprovedMessageTemplate,
    appealRejectedMessageTemplate: stored?.appealRejectedMessageTemplate ?? DEFAULT_APPEAL_MESSAGES.appealRejectedMessageTemplate
  };
}

function renderAppealTemplate(
  template: string,
  placeholders: { chat?: string; user?: string; action?: string; message?: string; comment?: string }
) {
  return template
    .replaceAll("%chat%", escapeTelegramHtml(placeholders.chat ?? ""))
    .replaceAll("%user%", escapeTelegramHtml(placeholders.user ?? ""))
    .replaceAll("%action%", escapeTelegramHtml(placeholders.action ?? ""))
    .replaceAll("%message%", escapeTelegramHtml(placeholders.message ?? ""))
    .replaceAll("%comment%", escapeTelegramHtml(placeholders.comment ?? ""));
}

// Personal moderation notice: an ephemeral message
// (Bot API 10.2) visible only to the punished member, posted right in the
// group they're already in, so it doesn't depend on them ever having opened
// a DM with the bot. A separate private DM used to also fire here, but it
// was removed (see the moderation-notification simplification) -- if the
// member knows /appeal, they can use it themselves; the ephemeral notice no
// longer points at any specific "reply here" instruction. Text is
// admin-editable in the moderation notification center with separate text
// for Telegram commands and for Web Admin/automatic moderation.
export async function notifyModerationTarget(input: {
  chatId: string;
  telegramChatId: bigint;
  telegramUserId: bigint;
  chatTitle: string;
  actionType: "WARNING" | "UNWARN" | "MUTE" | "UNMUTE" | "BAN" | "UNBAN" | "KICK";
  reason: string | null;
  warns?: string;
  notificationSource: ModerationNotificationSource;
  targetDisplayName?: string | null;
  admin?: { telegramUserId: number; displayName: string };
}) {
  try {
    const profile = await getModerationNotificationProfile(input.actionType);
    if (!profile.channels.OFFENDER.enabled) return { delivered: false as const };
    const botProfile = await getTelegramBotProfile();
    const contact = botProfile.username ? `@${botProfile.username}` : "мне в личные сообщения";
    await getTelegramClient().sendMessage({
      chatId: Number(input.telegramChatId),
      receiverUserId: Number(input.telegramUserId),
      ...renderTelegramModerationNotification(profile.channels.OFFENDER, input.notificationSource, {
        admin: input.admin ? { text: input.admin.displayName, telegramUserId: input.admin.telegramUserId } : "",
        target: { text: input.targetDisplayName ?? "Пользователь", telegramUserId: input.telegramUserId },
        chat: input.chatTitle,
        reason: input.reason ?? "",
        warns: input.warns ?? "",
        contact
      })
    });
    return { delivered: true as const };
  } catch {
    // Silently ignored -- e.g. the member was just removed from the chat
    // (BAN), or isn't a member yet. Best-effort, same as every other
    // Telegram notification call in this codebase.
    return { delivered: false as const };
  }
}

export async function notifyPunishmentAppealOption(input: {
  moderationActionId: string;
  chatId: string;
  telegramChatId: bigint;
  userId: string;
  telegramUserId: bigint;
  chatTitle: string;
  actionType: "WARNING" | "MUTE" | "BAN";
  reason: string | null;
  notificationSource: ModerationNotificationSource;
  targetDisplayName?: string | null;
  admin?: { telegramUserId: number; displayName: string };
}) {
  // Private punishment notice (ephemeral in-chat notice only -- the private
  // DM leg was removed) is independently controlled for this event.
  const profile = await getModerationNotificationProfile(input.actionType);
  if (!profile.channels.OFFENDER.enabled) return { delivered: false as const };

  await notifyModerationTarget({
    chatId: input.chatId,
    telegramChatId: input.telegramChatId,
    telegramUserId: input.telegramUserId,
    chatTitle: input.chatTitle,
    actionType: input.actionType,
    reason: input.reason,
    notificationSource: input.notificationSource,
    targetDisplayName: input.targetDisplayName,
    admin: input.admin
  });

  return { delivered: true as const };
}

export async function notifyAppealDecision(input: {
  chatId: string;
  telegramUserId: bigint;
  chatTitle: string;
  decision: "APPROVED" | "REJECTED";
  comment: string | null;
}) {
  // The user themself initiated /appeal -- this is the reply to their own
  // action, not a proactive rescue -- gated per chat (replaces the old
  // global proactiveDmNotificationsEnabled, now dropped from the schema; its
  // only reader was this exact call).
  const { settings } = await resolveEffectiveChatAppealSettings(input.chatId);
  if (!settings.notifyUserOnDecision) return { delivered: false as const };

  const messages = await getAppealMessages();
  const template = input.decision === "APPROVED" ? messages.appealApprovedMessageTemplate : messages.appealRejectedMessageTemplate;
  const text = renderAppealTemplate(template, {
    chat: input.chatTitle,
    comment: input.comment ? `\nКомментарий администратора: ${input.comment}` : ""
  });

  try {
    await getTelegramClient().sendMessage({ chatId: Number(input.telegramUserId), ...parseTelegramHtml(text) });
    return { delivered: true as const };
  } catch {
    return { delivered: false as const };
  }
}

export async function notifyAdminsOfNewAppeal(input: {
  chatId: string;
  appealId: string;
  chatTitle: string;
  userDisplayName: string;
  actionType: "WARNING" | "MUTE" | "BAN";
  message: string;
}) {
  const { settings } = await resolveEffectiveChatAppealSettings(input.chatId);
  if (!settings.notifyAdminsOnSubmit) return;

  const telegramModeratorIds = await listTelegramModeratorsForChat(input.chatId);
  if (telegramModeratorIds.length === 0) return;

  const messages = await getAppealMessages();
  const label = ACTION_LABELS[input.actionType] ?? input.actionType;
  const text = renderAppealTemplate(messages.appealNotifyAdminsMessageTemplate, {
    user: input.userDisplayName,
    chat: input.chatTitle,
    action: label,
    message: input.message
  });
  const client = getTelegramClient();

  for (const telegramUserId of telegramModeratorIds) {
    await client.sendMessage({
      chatId: Number(telegramUserId),
      ...parseTelegramHtml(text),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "✅ Одобрить", callback_data: buildAppealCallbackData(input.appealId, "APPROVE") },
            { text: "❌ Отклонить", callback_data: buildAppealCallbackData(input.appealId, "REJECT") }
          ]
        ]
      }
    }).catch(() => undefined);
  }
}
