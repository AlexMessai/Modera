import { prisma } from "@/server/db/prisma";
import {
  markBotChatTelegramError,
  syncTelegramChat,
  upsertTelegramBot
} from "@/server/services/chat-service";
import {
  observeMember,
  syncChatMemberUpdate,
  syncJoinRequest,
  syncKnownAdministrators,
  syncObservedMessage,
  syncServiceMemberships
} from "@/server/services/member-service";
import {
  getTelegramBotProfile,
  getTelegramClient,
  TelegramApiError
} from "@/server/telegram/client";
import type {
  TelegramChat,
  TelegramChatMember,
  TelegramUpdate
} from "@/server/telegram/types";

const BOT_CHAT_REFRESH_MS = 5 * 60 * 1000;

function extractChat(update: TelegramUpdate): TelegramChat | null {
  return (
    update.my_chat_member?.chat ??
    update.chat_member?.chat ??
    update.message?.chat ??
    update.edited_message?.chat ??
    update.chat_join_request?.chat ??
    update.callback_query?.message?.chat ??
    null
  );
}

function updateDate(update: TelegramUpdate) {
  const seconds =
    update.message?.date ??
    update.edited_message?.edit_date ??
    update.edited_message?.date ??
    update.my_chat_member?.date ??
    update.chat_member?.date ??
    update.chat_join_request?.date ??
    update.callback_query?.message?.date;

  return seconds ? new Date(seconds * 1000) : new Date();
}

function explicitBotMember(update: TelegramUpdate, botId: number) {
  const member = update.my_chat_member?.new_chat_member;
  if (member?.user.id === botId) return member;
  return null;
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  const chat = extractChat(update);
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
        message:
          error instanceof TelegramApiError
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
      currentBotTelegramId: botProfile.id
    });
  }

  if (update.message) {
    await syncObservedMessage({
      chatId: syncedChat.id,
      message: update.message,
      isEdited: false
    });
    await syncServiceMemberships({
      chatId: syncedChat.id,
      message: update.message,
      skipTelegramUserId: botProfile.id
    });
  }

  if (update.edited_message) {
    await syncObservedMessage({
      chatId: syncedChat.id,
      message: update.edited_message,
      isEdited: true
    });
  }

  if (
    update.chat_member &&
    update.chat_member.new_chat_member.user.id !== botProfile.id
  ) {
    await syncChatMemberUpdate({
      chatId: syncedChat.id,
      update: update.chat_member
    });
  }

  if (update.chat_join_request && update.chat_join_request.from.id !== botProfile.id) {
    await syncJoinRequest({
      chatId: syncedChat.id,
      user: update.chat_join_request.from,
      date: update.chat_join_request.date
    });
  }

  if (
    update.callback_query?.message &&
    update.callback_query.from.id !== botProfile.id
  ) {
    await observeMember({
      chatId: syncedChat.id,
      user: update.callback_query.from,
      date: update.callback_query.message.date
    });
  }

  if (
    update.my_chat_member?.from &&
    update.my_chat_member.from.id !== botProfile.id
  ) {
    await observeMember({
      chatId: syncedChat.id,
      user: update.my_chat_member.from,
      date: update.my_chat_member.date
    });
  }

  return { accepted: true, ignored: false };
}
