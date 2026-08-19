import type { TelegramPhotoSize } from "@/server/telegram/types";

export const TELEGRAM_AVATAR_REFRESH_MS = 24 * 60 * 60 * 1000;
export const TELEGRAM_AVATAR_NEGATIVE_REFRESH_MS = 15 * 60 * 1000;

export function avatarNeedsRefresh(
  syncedAt: Date | null,
  now = new Date(),
  hasAvatar = true
) {
  const refreshMs = hasAvatar
    ? TELEGRAM_AVATAR_REFRESH_MS
    : TELEGRAM_AVATAR_NEGATIVE_REFRESH_MS;
  return (
    !syncedAt ||
    now.getTime() - syncedAt.getTime() >= refreshMs
  );
}

export function resolveTelegramImageContentType(
  responseContentType: string | null,
  filePath: string
) {
  const declared = responseContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (declared?.startsWith("image/")) return declared;

  const extension = filePath.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return null;
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
