import type {
  TelegramApiEnvelope,
  TelegramChatMember,
  TelegramUser
} from "@/server/telegram/types";

const API_BASE = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export class TelegramClient {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, payload?: Record<string, unknown>): Promise<T> {
    const url = `${API_BASE}/bot${this.token}/${method}`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
        cache: "no-store"
      });

      const data = (await response.json()) as TelegramApiEnvelope<T>;
      if (response.ok && data.ok && data.result !== undefined) {
        return data.result;
      }

      const retryAfter = data.parameters?.retry_after;
      if (response.status === 429 && retryAfter && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      throw new TelegramApiError(
        data.description || "Telegram API request failed",
        data.error_code || response.status,
        retryAfter
      );
    }

    throw new TelegramApiError("Telegram API retry limit exceeded");
  }

  getMe() {
    return this.call<TelegramUser>("getMe");
  }

  getChatMember(chatId: number, userId: number) {
    return this.call<TelegramChatMember>("getChatMember", {
      chat_id: chatId,
      user_id: userId
    });
  }

  getChatMemberCount(chatId: number) {
    return this.call<number>("getChatMemberCount", { chat_id: chatId });
  }

  getWebhookInfo() {
    return this.call<{
      url: string;
      has_custom_certificate: boolean;
      pending_update_count: number;
      last_error_date?: number;
      last_error_message?: string;
    }>("getWebhookInfo");
  }

  setWebhook(input: {
    url: string;
    secretToken: string;
    allowedUpdates: string[];
  }) {
    return this.call<boolean>("setWebhook", {
      url: input.url,
      secret_token: input.secretToken,
      allowed_updates: input.allowedUpdates,
      drop_pending_updates: false
    });
  }
}

export function getTelegramClient() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }
  return new TelegramClient(token);
}
