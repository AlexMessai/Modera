import assert from "node:assert/strict";
import test from "node:test";
import {
  avatarNeedsRefresh,
  resolveTelegramImageContentType,
  selectLargestProfilePhoto,
  TELEGRAM_AVATAR_NEGATIVE_REFRESH_MS,
  TELEGRAM_AVATAR_REFRESH_MS
} from "./avatar-utils";

test("avatar refresh uses shorter negative caching", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  assert.equal(avatarNeedsRefresh(null, now), true);
  assert.equal(
    avatarNeedsRefresh(new Date(now.getTime() - TELEGRAM_AVATAR_REFRESH_MS + 1), now),
    false
  );
  assert.equal(
    avatarNeedsRefresh(new Date(now.getTime() - TELEGRAM_AVATAR_REFRESH_MS), now),
    true
  );
  assert.equal(
    avatarNeedsRefresh(
      new Date(now.getTime() - TELEGRAM_AVATAR_NEGATIVE_REFRESH_MS + 1),
      now,
      false
    ),
    false
  );
  assert.equal(
    avatarNeedsRefresh(
      new Date(now.getTime() - TELEGRAM_AVATAR_NEGATIVE_REFRESH_MS),
      now,
      false
    ),
    true
  );
});

test("Telegram image MIME falls back to the file path extension", () => {
  assert.equal(
    resolveTelegramImageContentType("application/octet-stream", "photos/avatar.jpg"),
    "image/jpeg"
  );
  assert.equal(
    resolveTelegramImageContentType("image/webp; charset=binary", "photos/avatar.bin"),
    "image/webp"
  );
  assert.equal(
    resolveTelegramImageContentType("application/json", "documents/file.bin"),
    null
  );
});

test("largest size from the newest Telegram profile photo is selected", () => {
  assert.equal(
    selectLargestProfilePhoto([
      [
        { file_id: "small", file_unique_id: "1", width: 160, height: 160 },
        { file_id: "large", file_unique_id: "2", width: 640, height: 640 },
        { file_id: "medium", file_unique_id: "3", width: 320, height: 320 }
      ],
      [{ file_id: "old", file_unique_id: "4", width: 800, height: 800 }]
    ]),
    "large"
  );
  assert.equal(selectLargestProfilePhoto([]), null);
});
