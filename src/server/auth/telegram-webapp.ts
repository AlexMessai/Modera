import { createHmac } from "node:crypto";

export type TelegramWebAppInitData = {
  queryId: string | null;
  userId: number;
  authDate: number;
};

// Telegram recommends rejecting stale Mini App sessions.
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export class TelegramWebAppError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "TelegramWebAppError";
  }
}

/**
 * Verifies Telegram.WebApp.initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app.
 * Unlike the Login Widget (secret_key = SHA256(bot_token)), Mini Apps derive
 * the secret key as HMAC_SHA256(bot_token, "WebAppData") — mixing the two up
 * silently fails every verification, so they're kept in separate modules
 * rather than sharing a "verify Telegram signature" helper.
 */
export function verifyTelegramWebAppInitData(initData: string, botToken: string): TelegramWebAppInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new TelegramWebAppError("INVALID_PAYLOAD", "Отсутствует подпись Telegram.");
  }
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    throw new TelegramWebAppError("INVALID_SIGNATURE", "Подпись Telegram не прошла проверку.");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) {
    throw new TelegramWebAppError("INVALID_PAYLOAD", "Отсутствует дата авторизации.");
  }
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) {
    throw new TelegramWebAppError("EXPIRED", "Сессия устарела, откройте заявку заново.");
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    throw new TelegramWebAppError("INVALID_PAYLOAD", "Отсутствуют данные пользователя.");
  }
  let userId: number;
  try {
    userId = Number(JSON.parse(userRaw).id);
  } catch {
    throw new TelegramWebAppError("INVALID_PAYLOAD", "Не удалось прочитать данные пользователя.");
  }
  if (!Number.isFinite(userId)) {
    throw new TelegramWebAppError("INVALID_PAYLOAD", "Некорректный идентификатор пользователя.");
  }

  return {
    queryId: params.get("query_id"),
    userId,
    authDate
  };
}
