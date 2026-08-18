import { prisma } from "@/server/db/prisma";
import {
  markBotChatTelegramError,
  syncTelegramChat,
  upsertTelegramBot
} from "@/server/services/chat-service";
import {
  getTelegramClient,
  TelegramApiError
} from "@/server/telegram/client";
import type {
  TelegramChat,
  TelegramChatMember,
  TelegramUpdate
} from "@/server/telegram/types";

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
  const botProfile = await client.getMe();
  const bot = await upsertTelegramBot(botProfile);

  let member: TelegramChatMember;
  let memberCount: number | null = null;

  try {
    member =
      explicitBotMember(update, botProfile.id) ??
      (await client.getChatMember(chat.id, botProfile.id));

    if (member.status !== "left" && member.status !== "kicked") {
      memberCount = await client.getChatMemberCount(chat.id).catch(() => null);
    }
  } catch (error) {
    const existingChat = await prisma.chat.findUnique({
      where: { telegramChatId: BigInt(chat.id) },
      select: { id: true }
    });

    if (existingChat) {
      await markBotChatTelegramError({
        botDbId: bot.id,
        chatId: existingChat.id,
        message:
          error instanceof TelegramApiError
            ? error.message
            : "Не удалось проверить состояние бота в Telegram"
      });
    }

    throw error;
  }

  await syncTelegramChat({
    chat,
    botDbId: bot.id,
    member,
    memberCount
  });

  return { accepted: true, ignored: false };
}
