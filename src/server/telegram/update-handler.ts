import { prisma } from "@/server/db/prisma";
import { deliverPendingAppealNotifications } from "@/server/services/appeal-notification-service";
import { submitAppealFromReply } from "@/server/services/appeal-service";
import { processAutomodMessage } from "@/server/services/automod-service";
import { maybeIssueCaptchaChallenge, parseCaptchaCallbackData, verifyCaptchaChallenge } from "@/server/services/captcha-service";
import { markBotChatTelegramError, syncTelegramChat, upsertTelegramBot } from "@/server/services/chat-service";
import { recordTelegramJoinRequest } from "@/server/services/join-request-service";
import { observeMember, syncChatMemberUpdate, syncJoinRequest, syncKnownAdministrators, syncObservedMessage, syncServiceMemberships } from "@/server/services/member-service";
import { recordAutomodIncident } from "@/server/services/moderation-incident-service";
import { recordAutomodViolationAndEscalate } from "@/server/services/moderation-escalation-service";
import { reconcileTelegramMemberState } from "@/server/services/moderation-reconciliation-service";
import { executeTelegramActorModerationAction, ModerationError, type ModerationActionValue } from "@/server/services/moderation-service";
import { getSelfServiceStatusMessage, listActiveMutes, selfUnmute } from "@/server/services/self-unmute-service";
import { isLiveTelegramChatAdmin } from "@/server/services/telegram-admin-service";
import { isTrustedTelegramMember, TRUSTED_INTERNAL_ROLE } from "@/server/services/trusted-member-service";
import { getTelegramBotProfile, getTelegramClient, TelegramApiError } from "@/server/telegram/client";
import type { TelegramChat, TelegramChatMember, TelegramChatMemberUpdated, TelegramMessage, TelegramUpdate } from "@/server/telegram/types";

const BOT_CHAT_REFRESH_MS = 5 * 60 * 1000;
const RULE_BY_AUTOMOD_RESULT: Record<string, string> = {
  DELETED_LINK: "LINK",
  DELETED_TERM: "TERM",
  DELETED_MEDIA: "MEDIA",
  DELETED_MENTIONS: "MENTIONS",
  DELETED_DUPLICATE: "DUPLICATE",
  DELETED_SPAM: "SPAM"
};

function extractChat(update: TelegramUpdate): TelegramChat | null {
  return update.my_chat_member?.chat ?? update.chat_member?.chat ?? update.message?.chat ?? update.edited_message?.chat ?? update.chat_join_request?.chat ?? update.callback_query?.message?.chat ?? null;
}

function updateDate(update: TelegramUpdate) {
  const seconds = update.message?.date ?? update.edited_message?.edit_date ?? update.edited_message?.date ?? update.my_chat_member?.date ?? update.chat_member?.date ?? update.chat_join_request?.date ?? update.callback_query?.message?.date;
  return seconds ? new Date(seconds * 1000) : new Date();
}

function explicitBotMember(update: TelegramUpdate, botId: number) {
  const member = update.my_chat_member?.new_chat_member;
  return member?.user.id === botId ? member : null;
}

function isNewMemberJoin(update: TelegramChatMemberUpdated) {
  const previous = update.old_chat_member.status;
  const next = update.new_chat_member.status;
  return (previous === "left" || previous === "kicked") && (next === "member" || next === "restricted");
}

async function runAutomod(input: { chatId: string; message: TelegramMessage; isEdited: boolean }) {
  if (!input.message.from || input.message.from.is_bot) return;
  if (await isTrustedTelegramMember(input.chatId, input.message.from.id)) return;

  const result = await processAutomodMessage(input);
  const rule = RULE_BY_AUTOMOD_RESULT[result.result];
  if (!rule) return;
  const violation = {
    chatId: input.chatId,
    telegramUserId: input.message.from.id,
    rule,
    telegramMessageId: String(input.message.message_id)
  };
  await Promise.all([
    recordAutomodViolationAndEscalate(violation).catch(() => undefined),
    recordAutomodIncident(violation).catch(() => undefined)
  ]);
}

const WARN_COMMAND_PATTERN = /^\/warn(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const MUTE_COMMAND_PATTERN = /^\/mute(?:@\w+)?\s*(?:(\d+)\s+)?([\s\S]*)$/i;
const BAN_COMMAND_PATTERN = /^\/ban(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const UNBAN_COMMAND_PATTERN = /^\/unban(?:@\w+)?\s*$/i;

const MODERATION_SUCCESS_TEXT: Record<ModerationActionValue, string> = {
  WARNING: "✅ Пользователь предупреждён.",
  MUTE: "✅ Пользователь замучен.",
  UNMUTE: "✅ Mute снят.",
  BAN: "✅ Пользователь заблокирован.",
  UNBAN: "✅ Блокировка снята."
};

async function processGroupModerationCommand(input: {
  chatId: string;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;

  let action: ModerationActionValue;
  let reason: string | null = null;
  let muteDurationMinutes: number | null = null;

  const warnMatch = WARN_COMMAND_PATTERN.exec(text);
  const muteMatch = !warnMatch ? MUTE_COMMAND_PATTERN.exec(text) : null;
  const banMatch = !warnMatch && !muteMatch ? BAN_COMMAND_PATTERN.exec(text) : null;
  const unbanMatch = !warnMatch && !muteMatch && !banMatch ? UNBAN_COMMAND_PATTERN.exec(text) : null;

  if (warnMatch) {
    action = "WARNING";
    reason = (warnMatch[1] ?? "").trim() || null;
  } else if (muteMatch) {
    action = "MUTE";
    muteDurationMinutes = muteMatch[1] ? Number(muteMatch[1]) : null;
    reason = (muteMatch[2] ?? "").trim() || null;
  } else if (banMatch) {
    action = "BAN";
    reason = (banMatch[1] ?? "").trim() || null;
  } else if (unbanMatch) {
    action = "UNBAN";
  } else {
    return false;
  }

  const reply = (replyText: string) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText }).catch(() => undefined);

  const isAdmin = await isLiveTelegramChatAdmin(input.telegramChatId, from.id);
  if (!isAdmin) {
    await reply("❌ У вас нет прав администратора в этом чате.");
    return true;
  }

  const target = input.message.reply_to_message?.from;
  if (!target) {
    await reply("Чтобы применить эту команду, ответьте (Reply) на сообщение участника, которого нужно наказать.");
    return true;
  }

  if (action === "MUTE" && !muteDurationMinutes) {
    await reply("Укажите срок mute в минутах: /mute <минут> <причина>");
    return true;
  }

  try {
    await executeTelegramActorModerationAction({
      chatId: input.chatId,
      targetTelegramUserId: target.id,
      action,
      reason,
      muteDurationMinutes,
      telegramActor: {
        telegramUserId: from.id,
        username: from.username,
        displayName: [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || undefined
      }
    });
    await reply(MODERATION_SUCCESS_TEXT[action]);
  } catch (error) {
    const message = error instanceof ModerationError ? error.message : "Не удалось выполнить действие модерации.";
    await reply(`❌ ${message}`);
  }

  return true;
}

const APPEAL_COMMAND_PATTERN = /^\/appeal(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const START_COMMAND_PATTERN = /^\/start(?:@\w+)?\s*$/i;
const HELP_COMMAND_PATTERN = /^\/help(?:@\w+)?\s*$/i;
const STATUS_COMMAND_PATTERN = /^\/status(?:@\w+)?\s*$/i;
const UNMUTE_COMMAND_PATTERN = /^\/unmute(?:@\w+)?(?:\s+(\d+))?\s*$/i;

const HELP_TEXT = [
  "Доступные команды:",
  "/status — ваш текущий статус и история наказаний",
  "/unmute — самостоятельно снять mute (до 3 раз в каждом чате)",
  "/appeal — подать апелляцию на бан или предупреждение (ответом на моё сообщение о наказании)",
  "/help — этот список команд"
].join("\n");

const START_TEXT = [
  "Привет! Я модератор-бот чатов, в которых вы состоите.",
  "",
  "Если вас ограничили — здесь можно самостоятельно снять mute (до 3 раз в каждом чате) или подать апелляцию на бан/предупреждение.",
  "",
  HELP_TEXT
].join("\n");

async function processPrivateMessage(message: TelegramMessage, botTelegramId: number) {
  const client = getTelegramClient();
  if (!message.from || message.from.id === botTelegramId || message.from.is_bot) {
    return { accepted: true, ignored: true };
  }

  // The user just opened a conversation with the bot (possibly for the first time) —
  // flush any punishment notifications that couldn't be sent earlier because Telegram
  // blocks bots from messaging users first.
  await deliverPendingAppealNotifications(message.from.id).catch(() => undefined);

  const text = message.text?.trim() ?? "";

  if (START_COMMAND_PATTERN.test(text)) {
    await client.sendMessage({ chatId: message.from.id, text: START_TEXT }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  if (HELP_COMMAND_PATTERN.test(text)) {
    await client.sendMessage({ chatId: message.from.id, text: HELP_TEXT }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  if (STATUS_COMMAND_PATTERN.test(text)) {
    const statusText = await getSelfServiceStatusMessage(message.from.id);
    await client.sendMessage({ chatId: message.from.id, text: statusText }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const unmuteMatch = UNMUTE_COMMAND_PATTERN.exec(text);
  if (unmuteMatch) {
    const active = await listActiveMutes(message.from.id);
    if (active.length === 0) {
      await client.sendMessage({
        chatId: message.from.id,
        text: "Вы не находитесь под ограничением ни в одном чате."
      }).catch(() => undefined);
      return { accepted: true, ignored: false };
    }

    let target = active[0];
    if (active.length > 1) {
      const index = unmuteMatch[1] ? Number(unmuteMatch[1]) : NaN;
      if (!Number.isInteger(index) || index < 1 || index > active.length) {
        const list = active.map((item, position) => `${position + 1}. ${item.chat.title}`).join("\n");
        await client.sendMessage({
          chatId: message.from.id,
          text: `У вас mute сразу в нескольких чатах. Укажите номер чата:\n${list}\n\nНапример: /unmute 1`
        }).catch(() => undefined);
        return { accepted: true, ignored: false };
      }
      target = active[index - 1];
    }

    const result = await selfUnmute({ telegramUserId: message.from.id, chatId: target.chatId });
    await client.sendMessage({ chatId: message.from.id, text: result.message }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const match = APPEAL_COMMAND_PATTERN.exec(text);
  if (!match) {
    return { accepted: true, ignored: true };
  }

  if (!message.reply_to_message) {
    await client.sendMessage({
      chatId: message.from.id,
      text: "Чтобы подать апелляцию, ответьте (Reply) на сообщение бота о наказании командой /appeal и текстом причины."
    }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const result = await submitAppealFromReply({
    fromTelegramUserId: message.from.id,
    replyToMessageId: message.reply_to_message.message_id,
    text: (match[1] ?? "").trim()
  });

  const replyText = {
    submitted: "Апелляция отправлена администраторам. Дождитесь решения.",
    already_submitted: "По этому наказанию апелляция уже была подана.",
    empty_message: "Опишите причину апелляции текстом после команды /appeal.",
    action_not_found: "Не удалось определить, к какому наказанию относится апелляция. Отвечайте именно на сообщение бота о наказании."
  }[result.outcome];

  await client.sendMessage({ chatId: message.from.id, text: replyText }).catch(() => undefined);
  return { accepted: true, ignored: false };
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  const chat = extractChat(update);

  if (chat?.type === "private" && update.message) {
    const botProfile = await getTelegramBotProfile();
    return processPrivateMessage(update.message, botProfile.id);
  }

  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
    return { accepted: true, ignored: true };
  }

  const client = getTelegramClient();
  const botProfile = await getTelegramBotProfile();
  const bot = await upsertTelegramBot(botProfile);
  const existingChat = await prisma.chat.findUnique({
    where: { telegramChatId: BigInt(chat.id) },
    select: {
      id: true,
      botLinks: {
        where: { botId: bot.id },
        take: 1,
        select: { lastSeenAt: true }
      }
    }
  });

  const explicitMember = explicitBotMember(update, botProfile.id);
  const lastBotCheck = existingChat?.botLinks[0]?.lastSeenAt?.getTime() ?? 0;
  const shouldRefreshBotState =
    Boolean(explicitMember) ||
    !existingChat ||
    existingChat.botLinks.length === 0 ||
    Date.now() - lastBotCheck >= BOT_CHAT_REFRESH_MS;
  let member: TelegramChatMember | null = explicitMember;
  let memberCount: number | null | undefined;
  let administrators: TelegramChatMember[] = [];

  if (!member && shouldRefreshBotState) {
    try {
      member = await client.getChatMember(chat.id, botProfile.id);
    } catch (error) {
      if (!existingChat) throw error;
      await markBotChatTelegramError({
        botDbId: bot.id,
        chatId: existingChat.id,
        message: error instanceof TelegramApiError
          ? error.message
          : "Не удалось проверить состояние бота в Telegram"
      });
    }
  }

  if (member && member.status !== "left" && member.status !== "kicked" && shouldRefreshBotState) {
    const [count, admins] = await Promise.all([
      client.getChatMemberCount(chat.id).catch(() => null),
      client.getChatAdministrators(chat.id).catch(() => [])
    ]);
    memberCount = count;
    administrators = admins;
  }

  const syncedChat = await syncTelegramChat({
    chat,
    botDbId: bot.id,
    member,
    memberCount,
    activityAt: updateDate(update)
  });

  if (administrators.length > 0) {
    const timestamp = Math.floor(updateDate(update).getTime() / 1000);
    await syncKnownAdministrators({
      chatId: syncedChat.id,
      administrators,
      date: timestamp,
      updateId: update.update_id,
      currentBotTelegramId: botProfile.id
    });
  }

  if (update.message) {
    await syncObservedMessage({
      chatId: syncedChat.id,
      message: update.message,
      isEdited: false,
      updateId: update.update_id
    });
    await syncServiceMemberships({
      chatId: syncedChat.id,
      message: update.message,
      updateId: update.update_id,
      skipTelegramUserId: botProfile.id
    });
    const commandHandled = update.message.text?.trim().startsWith("/")
      ? await processGroupModerationCommand({
          chatId: syncedChat.id,
          telegramChatId: chat.id,
          message: update.message,
          client
        })
      : false;
    if (!commandHandled) {
      await runAutomod({ chatId: syncedChat.id, message: update.message, isEdited: false });
    }
  }

  if (update.edited_message) {
    await syncObservedMessage({
      chatId: syncedChat.id,
      message: update.edited_message,
      isEdited: true,
      updateId: update.update_id
    });
    await runAutomod({ chatId: syncedChat.id, message: update.edited_message, isEdited: true });
  }

  if (update.chat_member && update.chat_member.new_chat_member.user.id !== botProfile.id) {
    const syncedMember = await syncChatMemberUpdate({
      chatId: syncedChat.id,
      update: update.chat_member,
      updateId: update.update_id
    });
    await reconcileTelegramMemberState({
      chatId: syncedChat.id,
      member: update.chat_member.new_chat_member,
      eventAt: new Date(update.chat_member.date * 1000)
    }).catch(() => undefined);

    if (
      isNewMemberJoin(update.chat_member) &&
      syncedMember.membership.internalRole !== TRUSTED_INTERNAL_ROLE
    ) {
      await maybeIssueCaptchaChallenge({
        chatId: syncedChat.id,
        chatType: chat.type,
        membershipId: syncedMember.membership.id,
        userId: syncedMember.user.id,
        telegramChatId: BigInt(chat.id),
        telegramUserId: BigInt(update.chat_member.new_chat_member.user.id),
        displayName: syncedMember.user.displayName
      }).catch(() => undefined);
    }
  }

  if (update.chat_join_request && update.chat_join_request.from.id !== botProfile.id) {
    await syncJoinRequest({
      chatId: syncedChat.id,
      user: update.chat_join_request.from,
      date: update.chat_join_request.date,
      updateId: update.update_id
    });
    await recordTelegramJoinRequest({
      chatId: syncedChat.id,
      request: update.chat_join_request,
      updateId: update.update_id
    });
  }

  if (update.callback_query?.message && update.callback_query.from.id !== botProfile.id) {
    await observeMember({
      chatId: syncedChat.id,
      user: update.callback_query.from,
      date: update.callback_query.message.date,
      updateId: update.update_id
    });

    const targetTelegramUserId = update.callback_query.data
      ? parseCaptchaCallbackData(update.callback_query.data)
      : null;
    if (targetTelegramUserId !== null) {
      const result = await verifyCaptchaChallenge({
        chatId: syncedChat.id,
        telegramChatId: BigInt(chat.id),
        fromTelegramUserId: update.callback_query.from.id,
        targetTelegramUserId
      });

      if (result.outcome === "verified") {
        await client.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
          text: "✅ Проверка пройдена, добро пожаловать!",
          showAlert: true
        }).catch(() => undefined);
        await client.deleteMessage(
          Number(chat.id),
          update.callback_query.message.message_id
        ).catch(() => undefined);
      } else if (result.outcome === "wrong_user") {
        await client.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
          text: "Эта кнопка не для вас.",
          showAlert: true
        }).catch(() => undefined);
      } else {
        await client.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
          text: "Проверка уже недействительна."
        }).catch(() => undefined);
      }
    }
  }

  if (update.my_chat_member?.from && update.my_chat_member.from.id !== botProfile.id) {
    await observeMember({
      chatId: syncedChat.id,
      user: update.my_chat_member.from,
      date: update.my_chat_member.date,
      updateId: update.update_id
    });
  }

  return { accepted: true, ignored: false };
}
