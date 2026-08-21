import { resolveEffectiveContentSettings, renderWelcomeTemplate } from "@/server/services/content-settings-service";
import { getTelegramClient } from "@/server/telegram/client";

/** Best-effort, fire-and-forget -- called from update-handler.ts's new-member join block, alongside captcha/anti-raid. */
export async function sendWelcomeMessage(input: {
  chatId: string;
  telegramChatId: number;
  chatTitle: string;
  memberCount: number | null;
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

    await getTelegramClient().sendMessage({ chatId: input.telegramChatId, text });
  } catch {
    // Best-effort: e.g. the bot lost posting rights right after the join event fired.
  }
}
