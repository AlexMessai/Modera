import { prisma } from "@/server/db/prisma";
import { getTelegramClient } from "@/server/telegram/client";
import {
  avatarNeedsRefresh,
  selectLargestProfilePhoto
} from "@/server/telegram/avatar-utils";

export type TelegramAvatarResult =
  | { kind: "image"; bytes: ArrayBuffer; contentType: string; displayName: string }
  | { kind: "fallback"; displayName: string };

function telegramErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown Telegram error";
}

export async function getTelegramUserAvatar(
  userId: string
): Promise<TelegramAvatarResult | null> {
  const foundUser = await prisma.telegramUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      telegramUserId: true,
      displayName: true,
      avatarFileId: true,
      avatarSyncedAt: true
    }
  });
  if (!foundUser) return null;
  const user = foundUser;

  const client = getTelegramClient();
  let avatarFileId = user.avatarFileId;
  let refreshAttempted = false;

  async function refreshAvatarFileId() {
    refreshAttempted = true;
    const profilePhotos = await client.getUserProfilePhotos(
      Number(user.telegramUserId),
      1
    );
    const nextFileId = selectLargestProfilePhoto(profilePhotos.photos);
    await prisma.telegramUser.update({
      where: { id: user.id },
      data: { avatarFileId: nextFileId, avatarSyncedAt: new Date() }
    });
    return nextFileId;
  }

  if (avatarNeedsRefresh(user.avatarSyncedAt, new Date(), Boolean(avatarFileId))) {
    try {
      avatarFileId = await refreshAvatarFileId();
    } catch (error) {
      console.warn("[telegram-avatar] profile photo sync failed", {
        userId: user.id,
        telegramUserId: user.telegramUserId.toString(),
        error: telegramErrorMessage(error)
      });
      // Keep a previously known photo when Telegram is temporarily unavailable.
    }
  }

  if (!avatarFileId) {
    return { kind: "fallback", displayName: user.displayName };
  }

  async function download(fileId: string) {
    const file = await client.downloadFile(fileId);
    return {
      kind: "image" as const,
      bytes: file.bytes,
      contentType: file.contentType,
      displayName: user.displayName
    };
  }

  try {
    return await download(avatarFileId);
  } catch (error) {
    console.warn("[telegram-avatar] cached photo download failed", {
      userId: user.id,
      telegramUserId: user.telegramUserId.toString(),
      error: telegramErrorMessage(error)
    });

    if (!refreshAttempted) {
      try {
        const refreshedFileId = await refreshAvatarFileId();
        if (!refreshedFileId) {
          return { kind: "fallback", displayName: user.displayName };
        }
        return await download(refreshedFileId);
      } catch (refreshError) {
        console.warn("[telegram-avatar] photo retry failed", {
          userId: user.id,
          telegramUserId: user.telegramUserId.toString(),
          error: telegramErrorMessage(refreshError)
        });
      }
    }

    return { kind: "fallback", displayName: user.displayName };
  }
}
