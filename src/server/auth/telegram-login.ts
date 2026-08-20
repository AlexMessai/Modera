import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TelegramLoginPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

// Telegram recommends rejecting stale login attempts — a captured widget
// payload shouldn't be replayable indefinitely.
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export class TelegramLoginError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "TelegramLoginError";
  }
}

/**
 * Verifies a Telegram Login Widget payload per
 * https://core.telegram.org/widgets/login#checking-authorization.
 * Throws TelegramLoginError if the signature is missing/wrong or the login
 * attempt is too old to trust.
 */
export function verifyTelegramLoginPayload(payload: TelegramLoginPayload, botToken: string): TelegramLoginPayload {
  const { hash, ...rest } = payload;
  if (!hash) {
    throw new TelegramLoginError("INVALID_PAYLOAD", "Отсутствует подпись Telegram.");
  }

  const dataCheckString = Object.entries(rest)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const expected = Buffer.from(computedHash, "hex");
  const actual = Buffer.from(hash, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new TelegramLoginError("INVALID_SIGNATURE", "Подпись Telegram не прошла проверку.");
  }

  const ageSeconds = Date.now() / 1000 - payload.auth_date;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) {
    throw new TelegramLoginError("EXPIRED", "Данные авторизации Telegram устарели, попробуйте войти ещё раз.");
  }

  return payload;
}
