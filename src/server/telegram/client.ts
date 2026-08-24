import type {
  TelegramApiEnvelope,
  TelegramChatMember,
  TelegramChatPhoto,
  TelegramFile,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramMessageEntity,
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

export type TelegramChatAdministratorRights = {
  is_anonymous: boolean;
  can_manage_chat: boolean;
  can_delete_messages: boolean;
  can_manage_video_chats: boolean;
  can_restrict_members: boolean;
  can_promote_members: boolean;
  can_change_info: boolean;
  can_invite_users: boolean;
  can_pin_messages: boolean;
  can_post_stories: boolean;
  can_edit_stories: boolean;
  can_delete_stories: boolean;
  can_manage_topics: boolean;
  can_manage_tags: boolean;
};

// Requested when adding the bot to a group -- everything except anonymity
// (an anonymous admin's actions show up as "the group", which would break
// audit attribution in the Журнал). Deliberately broader than what Modera's
// own moderation code currently exercises (only can_delete_messages/
// can_restrict_members are checked by canModerate() in status.ts): the user
// asked for the one-tap "grant everything" experience Telegram's own
// promote-to-admin screen defaults to, rather than a minimal-privilege set.
// Also the single source of truth for the "Добавить бота в группу" deep
// link's admin= parameter, via buildAdminRightsDeepLinkParam below, so the
// two can never drift apart.
export const GROUP_ADMIN_RIGHTS: TelegramChatAdministratorRights = {
  is_anonymous: false,
  can_manage_chat: true,
  can_delete_messages: true,
  can_manage_video_chats: true,
  can_restrict_members: true,
  can_promote_members: true,
  can_change_info: true,
  can_invite_users: true,
  can_pin_messages: true,
  can_post_stories: true,
  can_edit_stories: true,
  can_delete_stories: true,
  can_manage_topics: true,
  can_manage_tags: true
};

// Telegram's deep-link spec (core.telegram.org/api/links) joins requested
// rights with "+", using the ChatAdministratorRights field name minus its
// "can_" prefix.
export function buildAdminRightsDeepLinkParam(
  rights: TelegramChatAdministratorRights
): string {
  return Object.entries(rights)
    .filter(([key, value]) => value && key.startsWith("can_"))
    .map(([key]) => key.slice("can_".length))
    .join("+");
}

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

  /** `permissions` (silence-service.ts, snapshotting default member permissions before locking down) and `photo` (telegram-chat-avatar-service.ts, the chat's current avatar) are the only fields callers need. */
  getChat(chatId: number) {
    return this.call<{ permissions?: TelegramChatPermissions; photo?: TelegramChatPhoto }>("getChat", { chat_id: chatId });
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

  // Ephemeral messages (Bot API 10.2) use their own delete method keyed by
  // ephemeral_message_id -- deleteMessage's message_id is always 0 for them.
  deleteEphemeralMessage(chatId: number, ephemeralMessageId: number) {
    return this.call<boolean>("deleteEphemeralMessage", {
      chat_id: chatId,
      ephemeral_message_id: ephemeralMessageId
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

  /** Chat-wide default member permissions -- distinct from restrictChatMember's per-user restriction, used by silence-service.ts's chat-wide lockdown. Moderators/admins keep their own explicit rights regardless. */
  setChatPermissions(input: { chatId: number; permissions: TelegramChatPermissions }) {
    return this.call<boolean>("setChatPermissions", {
      chat_id: input.chatId,
      permissions: input.permissions,
      use_independent_chat_permissions: true
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

  sendMessage(input: {
    chatId: number;
    text: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
    entities?: TelegramMessageEntity[];
    // Bot API 10.2: sent by a chat administrator, makes the message visible
    // only to this one non-bot member instead of the whole chat.
    receiverUserId?: number;
  }) {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      ...(input.entities?.length ? { entities: input.entities } : {}),
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
      ...(input.receiverUserId ? { receiver_user_id: input.receiverUserId } : {})
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

  setMyDefaultAdministratorRights(rights: TelegramChatAdministratorRights) {
    return this.call<boolean>("setMyDefaultAdministratorRights", {
      rights,
      for_channels: false
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
