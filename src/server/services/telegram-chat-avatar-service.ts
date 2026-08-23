import { prisma } from "@/server/db/prisma";
import { getTelegramClient } from "@/server/telegram/client";
import { avatarNeedsRefresh } from "@/server/telegram/avatar-utils";

export type TelegramChatAvatarResult =
  | { kind: "image"; bytes: ArrayBuffer; contentType: string; displayName: string }
  | { kind: "fallback"; displayName: string };

function telegramErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown Telegram error";
}

export async function getTelegramChatAvatar(
  chatId: string
): Promise<TelegramChatAvatarResult | null> {
  const foundChat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      telegramChatId: true,
      title: true,
      photoFileId: true,
      avatarSyncedAt: true
    }
  });
  if (!foundChat) return null;
  const chat = foundChat;

  const client = getTelegramClient();
  let photoFileId = chat.photoFileId;
  let refreshAttempted = false;

  async function refreshPhotoFileId() {
    refreshAttempted = true;
    const info = await client.getChat(Number(chat.telegramChatId));
    const nextFileId = info.photo?.big_file_id ?? null;
    await prisma.chat.update({
      where: { id: chat.id },
      data: { photoFileId: nextFileId, avatarSyncedAt: new Date() }
    });
    return nextFileId;
  }

  if (avatarNeedsRefresh(chat.avatarSyncedAt, new Date(), Boolean(photoFileId))) {
    try {
      photoFileId = await refreshPhotoFileId();
    } catch (error) {
      console.warn("[telegram-chat-avatar] chat photo sync failed", {
        chatId: chat.id,
        telegramChatId: chat.telegramChatId.toString(),
        error: telegramErrorMessage(error)
      });
      // Keep a previously known photo when Telegram is temporarily unavailable.
    }
  }

  if (!photoFileId) {
    return { kind: "fallback", displayName: chat.title };
  }

  async function download(fileId: string) {
    const file = await client.downloadFile(fileId);
    return {
      kind: "image" as const,
      bytes: file.bytes,
      contentType: file.contentType,
      displayName: chat.title
    };
  }

  try {
    return await download(photoFileId);
  } catch (error) {
    console.warn("[telegram-chat-avatar] cached photo download failed", {
      chatId: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      error: telegramErrorMessage(error)
    });

    if (!refreshAttempted) {
      try {
        const refreshedFileId = await refreshPhotoFileId();
        if (!refreshedFileId) {
          return { kind: "fallback", displayName: chat.title };
        }
        return await download(refreshedFileId);
      } catch (refreshError) {
        console.warn("[telegram-chat-avatar] photo retry failed", {
          chatId: chat.id,
          telegramChatId: chat.telegramChatId.toString(),
          error: telegramErrorMessage(refreshError)
        });
      }
    }

    return { kind: "fallback", displayName: chat.title };
  }
}
