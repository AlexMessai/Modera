import type {
  TelegramApiEnvelope,
  TelegramChatMember,
  TelegramFile,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramUserProfilePhotos,
  TelegramUser
} from "@/server/telegram/types";
import { resolveTelegramImageContentType } from "@/server/telegram/avatar-utils";

const API_BASE = "https://api.telegram.org";
const BOT_PROFILE_CACHE_MS = 10 * 60 * 1000;

export type TelegramChatPermissions = {
  can_send_messages: boolean;
  can_send_audios: boolean;
  can_send_documents: boolean;
  can_send_photos: boolean;
  can_send_videos: boolean;
  can_send_video_notes: boolean;
  can_send_voice_notes: boolean;
  can_send_polls: boolean;
  can_send_other_messages: boolean;
  can_add_web_page_previews: boolean;
  can_change_info: boolean;
  can_invite_users: boolean;
  can_pin_messages: boolean;
  can_manage_topics: boolean;
};

export const MUTED_CHAT_PERMISSIONS: TelegramChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false
};

export const UNRESTRICTED_CHAT_PERMISSIONS: TelegramChatPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: true,
  can_invite_users: true,
  can_pin_messages: true,
  can_manage_topics: true
};

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

  getChatAdministrators(chatId: number) {
    return this.call<TelegramChatMember[]>("getChatAdministrators", {
      chat_id: chatId
    });
  }

  getUserProfilePhotos(userId: number, limit = 1) {
    return this.call<TelegramUserProfilePhotos>("getUserProfilePhotos", {
      user_id: userId,
      offset: 0,
      limit
    });
  }

  getFile(fileId: string) {
    return this.call<TelegramFile>("getFile", { file_id: fileId });
  }

  async downloadFile(fileId: string) {
    const file = await this.getFile(fileId);
    const filePath = file.file_path;
    if (!filePath || filePath.startsWith("/") || filePath.includes("..")) {
      throw new TelegramApiError("Telegram returned an invalid file path");
    }

    const encodedPath = filePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const response = await fetch(
      `${API_BASE}/file/bot${this.token}/${encodedPath}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new TelegramApiError(
        "Telegram file download failed",
        response.status
      );
    }

    const contentType = resolveTelegramImageContentType(
      response.headers.get("content-type"),
      filePath
    );
    if (!contentType) {
      throw new TelegramApiError("Telegram returned a non-image file");
    }

    return {
      bytes: await response.arrayBuffer(),
      contentType
    };
  }

  deleteMessage(chatId: number, messageId: number) {
    return this.call<boolean>("deleteMessage", {
      chat_id: chatId,
      message_id: messageId
    });
  }

  restrictChatMember(input: {
    chatId: number;
    userId: number;
    permissions: TelegramChatPermissions;
    untilDate?: number;
  }) {
    return this.call<boolean>("restrictChatMember", {
      chat_id: input.chatId,
      user_id: input.userId,
      permissions: input.permissions,
      use_independent_chat_permissions: true,
      ...(input.untilDate ? { until_date: input.untilDate } : {})
    });
  }

  banChatMember(input: {
    chatId: number;
    userId: number;
    untilDate?: number;
    revokeMessages?: boolean;
  }) {
    return this.call<boolean>("banChatMember", {
      chat_id: input.chatId,
      user_id: input.userId,
      ...(input.untilDate ? { until_date: input.untilDate } : {}),
      ...(input.revokeMessages !== undefined
        ? { revoke_messages: input.revokeMessages }
        : {})
    });
  }

  unbanChatMember(input: {
    chatId: number;
    userId: number;
    onlyIfBanned?: boolean;
  }) {
    return this.call<boolean>("unbanChatMember", {
      chat_id: input.chatId,
      user_id: input.userId,
      only_if_banned: input.onlyIfBanned ?? true
    });
  }

  approveChatJoinRequest(chatId: number, userId: number) {
    return this.call<boolean>("approveChatJoinRequest", {
      chat_id: chatId,
      user_id: userId
    });
  }

  declineChatJoinRequest(chatId: number, userId: number) {
    return this.call<boolean>("declineChatJoinRequest", {
      chat_id: chatId,
      user_id: userId
    });
  }

  // Bot API 10.1 "Join Request Queries" — resolves a chat_join_request that
  // carries a query_id (only present when this bot is the chat's guard_bot).
  // Must be called within 10 seconds of receiving the update. The wire
  // parameter is chat_join_request_query_id (NOT query_id — that's only the
  // name of the field on the incoming ChatJoinRequest update), and the
  // decision is the string "approve"/"decline" (NOT a boolean) — verified
  // against the raw method reference table on core.telegram.org/bots/api,
  // since every mirror/SDK doc checked while building this returned a
  // different, wrong shape.
  answerChatJoinRequestQuery(queryId: string, approved: boolean) {
    return this.call<boolean>("answerChatJoinRequestQuery", {
      chat_join_request_query_id: queryId,
      result: approved ? "approve" : "decline"
    });
  }

  // Opens a Mini App screening step for a join request query instead of
  // deciding immediately — the applicant confirms inside the Mini App, which
  // then calls answerChatJoinRequestQuery itself with that same query_id.
  sendChatJoinRequestWebApp(queryId: string, webAppUrl: string) {
    return this.call<boolean>("sendChatJoinRequestWebApp", {
      chat_join_request_query_id: queryId,
      web_app_url: webAppUrl
    });
  }

  sendMessage(input: {
    chatId: number;
    text: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }) {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {})
    });
  }

  editMessageText(input: {
    chatId: number;
    messageId: number;
    text: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }) {
    return this.call<TelegramMessage | boolean>("editMessageText", {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      reply_markup: input.replyMarkup ?? { inline_keyboard: [] }
    });
  }

  answerCallbackQuery(input: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }) {
    return this.call<boolean>("answerCallbackQuery", {
      callback_query_id: input.callbackQueryId,
      ...(input.text ? { text: input.text } : {}),
      ...(input.showAlert ? { show_alert: input.showAlert } : {})
    });
  }

  setChatMemberTag(input: {
    chatId: number;
    userId: number;
    tag: string;
  }) {
    return this.call<boolean>("setChatMemberTag", {
      chat_id: input.chatId,
      user_id: input.userId,
      tag: input.tag
    });
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

let singletonClient: TelegramClient | null = null;
let singletonToken: string | null = null;
let cachedBotProfile: { value: TelegramUser; expiresAt: number } | null = null;

export function getTelegramClient() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  if (!singletonClient || singletonToken !== token) {
    singletonClient = new TelegramClient(token);
    singletonToken = token;
    cachedBotProfile = null;
  }

  return singletonClient;
}

export async function getTelegramBotProfile() {
  const now = Date.now();
  if (cachedBotProfile && cachedBotProfile.expiresAt > now) {
    return cachedBotProfile.value;
  }

  const value = await getTelegramClient().getMe();
  cachedBotProfile = {
    value,
    expiresAt: now + BOT_PROFILE_CACHE_MS
  };
  return value;
}
