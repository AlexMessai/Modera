import { getTelegramClient } from "@/server/telegram/client";

export async function isLiveTelegramChatAdmin(chatTelegramId: number, telegramUserId: number) {
  try {
    const client = getTelegramClient();
    const administrators = await client.getChatAdministrators(chatTelegramId);
    return administrators.some(
      (member) =>
        member.user.id === telegramUserId &&
        (member.status === "creator" || member.status === "administrator")
    );
  } catch {
    return false;
  }
}
