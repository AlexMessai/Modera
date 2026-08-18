import type { TelegramPhotoSize } from "@/server/telegram/types";

export const TELEGRAM_AVATAR_REFRESH_MS = 24 * 60 * 60 * 1000;

export function avatarNeedsRefresh(
  syncedAt: Date | null,
  now = new Date()
) {
  return (
    !syncedAt ||
    now.getTime() - syncedAt.getTime() >= TELEGRAM_AVATAR_REFRESH_MS
  );
}

export function selectLargestProfilePhoto(photos: TelegramPhotoSize[][]) {
  const firstPhoto = photos[0];
  if (!firstPhoto?.length) return null;

  return firstPhoto.reduce((largest, candidate) =>
    candidate.width * candidate.height > largest.width * largest.height
      ? candidate
      : largest
  ).file_id;
}
