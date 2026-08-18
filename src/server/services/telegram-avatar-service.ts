import { prisma } from "@/server/db/prisma";
import { getTelegramClient } from "@/server/telegram/client";
import {
  avatarNeedsRefresh,
  selectLargestProfilePhoto
} from "@/server/telegram/avatar-utils";

export type TelegramAvatarResult =
  | { kind: "image"; bytes: ArrayBuffer; contentType: string; displayName: string }
  | { kind: "fallback"; displayName: string };

export async function getTelegramUserAvatar(
  userId: string
): Promise<TelegramAvatarResult | null> {
  const user = await prisma.telegramUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      telegramUserId: true,
      displayName: true,
      avatarFileId: true,
      avatarSyncedAt: true
    }
  });
  if (!user) return null;

  const client = getTelegramClient();
  let avatarFileId = user.avatarFileId;

  if (avatarNeedsRefresh(user.avatarSyncedAt)) {
    try {
      const profilePhotos = await client.getUserProfilePhotos(
        Number(user.telegramUserId),
        1
      );
      avatarFileId = selectLargestProfilePhoto(profilePhotos.photos);
      await prisma.telegramUser.update({
        where: { id: user.id },
        data: { avatarFileId, avatarSyncedAt: new Date() }
      });
    } catch {
      // Keep a previously known photo when Telegram is temporarily unavailable.
    }
  }

  if (!avatarFileId) {
    return { kind: "fallback", displayName: user.displayName };
  }

  try {
    const file = await client.downloadFile(avatarFileId);
    return {
      kind: "image",
      bytes: file.bytes,
      contentType: file.contentType,
      displayName: user.displayName
    };
  } catch {
    return { kind: "fallback", displayName: user.displayName };
  }
}
