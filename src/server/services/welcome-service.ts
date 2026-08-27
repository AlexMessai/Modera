import { resolveEffectiveContentSettings, renderWelcomeTemplate } from "@/server/services/content-settings-service";
import { getTelegramClient } from "@/server/telegram/client";
import { parseTelegramHtml } from "@/server/telegram/formatted-text";

/** Best-effort, fire-and-forget -- called from update-handler.ts's new-member join block, alongside captcha/anti-raid. */
export async function sendWelcomeMessage(input: {
  chatId: string;
  telegramChatId: number;
  chatTitle: string;
  memberCount: number | null;
  newMemberTelegramUserId: number;
  newMemberFirstName: string;
  newMemberUsername: string | null;
}) {
  try {
    const { settings } = await resolveEffectiveContentSettings(input.chatId);
    if (!settings.welcomeEnabled) return;

    const text = renderWelcomeTemplate(settings.welcomeMessageTemplate, {
      name: input.newMemberFirstName,
      username: input.newMemberUsername ? `@${input.newMemberUsername}` : input.newMemberFirstName,
      group: input.chatTitle,
      memberCount: input.memberCount !== null ? String(input.memberCount) : "—"
    });

    const formatted = parseTelegramHtml(text);
    await getTelegramClient().sendMessage({
      chatId: input.telegramChatId,
      ...formatted,
      replyMarkup: settings.welcomeButtons.length ? { inline_keyboard: [settings.welcomeButtons.map((button) => ({ text: button.text, url: button.url }))] } : undefined,
      // Bot API 10.3's ephemeral_message_parameters, gated behind the
      // can_send_welcome_messages admin right (requested by default in
      // GROUP_ADMIN_RIGHTS) -- mirrors Telegram's own native "Приветствие"
      // group setting, which is visible only to the joining member rather
      // than posted into the chat for everyone.
      receiverUserId: input.newMemberTelegramUserId
    });
  } catch {
    // Best-effort: e.g. the bot lost posting rights right after the join event fired.
  }
}
