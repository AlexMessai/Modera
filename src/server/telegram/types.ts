export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: true;
  added_to_attachment_menu?: true;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel" | string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramChatMember = {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" | string;
  user: TelegramUser;
  tag?: string;
  custom_title?: string;
  until_date?: number;
  is_member?: boolean;
  can_send_messages?: boolean;
  can_send_audios?: boolean;
  can_send_documents?: boolean;
  can_send_photos?: boolean;
  can_send_videos?: boolean;
  can_send_video_notes?: boolean;
  can_send_voice_notes?: boolean;
  can_send_polls?: boolean;
  can_send_other_messages?: boolean;
  can_add_web_page_previews?: boolean;
  can_manage_chat?: boolean;
  can_delete_messages?: boolean;
  can_manage_video_chats?: boolean;
  can_restrict_members?: boolean;
  can_promote_members?: boolean;
  can_change_info?: boolean;
  can_invite_users?: boolean;
  can_pin_messages?: boolean;
  can_manage_topics?: boolean;
  can_manage_tags?: boolean;
  can_post_stories?: boolean;
  can_edit_stories?: boolean;
  can_delete_stories?: boolean;
};

export type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
  language?: string;
  custom_emoji_id?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  edit_date?: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  photo?: unknown[];
  video?: unknown;
  animation?: unknown;
  document?: unknown;
  sticker?: unknown;
  voice?: unknown;
  audio?: unknown;
  video_note?: unknown;
  poll?: unknown;
  dice?: unknown;
  location?: unknown;
  contact?: unknown;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
};

export type TelegramChatMemberUpdated = {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
};

export type TelegramChatJoinRequest = {
  chat: TelegramChat;
  from: TelegramUser;
  user_chat_id: number;
  date: number;
  bio?: string;
  invite_link?: {
    invite_link: string;
    name?: string;
    creates_join_request?: boolean;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdated;
  chat_member?: TelegramChatMemberUpdated;
  chat_join_request?: TelegramChatJoinRequest;
  callback_query?: { id: string; from: TelegramUser; message?: TelegramMessage };
};

export type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramUserProfilePhotos = {
  total_count: number;
  photos: TelegramPhotoSize[][];
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};
