import { prisma } from "@/server/db/prisma";
import { getChatModerationProfile, updateChatModerationSettings } from "@/server/services/chat-moderation-settings-service";
import { getChatCaptchaProfile, updateChatCaptchaProfile } from "@/server/services/captcha-settings-service";
import { getChatContentProfile, updateChatContentSettings } from "@/server/services/content-settings-service";
import { getChatAntiRaidProfile, updateChatAntiRaidSettings } from "@/server/services/anti-raid-settings-service";
import { getChatManualModerationProfile, updateChatManualModerationProfile } from "@/server/services/manual-moderation-settings-service";
import { getChatAppealProfile, updateChatAppealProfile } from "@/server/services/chat-appeal-settings-service";
import { getChatReportProfile, updateChatReportSettings } from "@/server/services/report-settings-service";
import { listChatRoles, updateChatRolePermissions } from "@/server/services/chat-role-service";

export const COPYABLE_SETTINGS_SECTIONS = ["automod", "newusers", "antiraid", "manual", "appeals", "roles", "reports"] as const;
export type CopyableSettingsSection = (typeof COPYABLE_SETTINGS_SECTIONS)[number];

export function isCopyableSettingsSection(value: string): value is CopyableSettingsSection {
  return (COPYABLE_SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export class ChatSettingsCopyError extends Error {
  code: string;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * One-time copy, not a live link: writes the source chat's current settings
 * into the target chat's own rows via the same update functions the settings
 * UI itself calls (so validation/normalization matches exactly), then the
 * two chats are independent again. "Команда" (real people's panel access)
 * and "Канал логов" (a specific external channel id) are deliberately never
 * copyable -- copying them would misdirect access/logs, not just content.
 */
export async function copyChatSettings(input: {
  sourceChatId: string;
  targetChatId: string;
  actingAdminId: string;
  sections: CopyableSettingsSection[];
}) {
  if (input.sourceChatId === input.targetChatId) {
    throw new ChatSettingsCopyError("SAME_CHAT", "Нельзя скопировать настройки чата в самого себя.", 422);
  }

  const sections = Array.from(new Set(input.sections.filter(isCopyableSettingsSection)));
  if (sections.length === 0) {
    throw new ChatSettingsCopyError("NO_SECTIONS", "Выберите хотя бы один раздел для копирования.", 422);
  }

  const applied: CopyableSettingsSection[] = [];

  for (const section of sections) {
    switch (section) {
      case "automod": {
        const source = await getChatModerationProfile(input.sourceChatId);
        if (!source) break;
        const saved = await updateChatModerationSettings({
          chatId: input.targetChatId,
          actingAdminId: input.actingAdminId,
          ...source.settings
        });
        if (saved) applied.push(section);
        break;
      }
      case "newusers": {
        const [captcha, content] = await Promise.all([
          getChatCaptchaProfile(input.sourceChatId),
          getChatContentProfile(input.sourceChatId)
        ]);
        let touched = false;
        if (captcha) {
          await updateChatCaptchaProfile({ chatId: input.targetChatId, actingAdminId: input.actingAdminId, settings: captcha.settings });
          touched = true;
        }
        if (content) {
          await updateChatContentSettings({ chatId: input.targetChatId, actingAdminId: input.actingAdminId, settings: content.settings });
          touched = true;
        }
        if (touched) applied.push(section);
        break;
      }
      case "antiraid": {
        const source = await getChatAntiRaidProfile(input.sourceChatId);
        if (!source) break;
        await updateChatAntiRaidSettings({ chatId: input.targetChatId, actingAdminId: input.actingAdminId, settings: source.settings });
        applied.push(section);
        break;
      }
      case "manual": {
        const source = await getChatManualModerationProfile(input.sourceChatId);
        if (!source) break;
        await updateChatManualModerationProfile({ chatId: input.targetChatId, actingAdminId: input.actingAdminId, settings: source.settings });
        applied.push(section);
        break;
      }
      case "appeals": {
        const source = await getChatAppealProfile(input.sourceChatId);
        if (!source) break;
        await updateChatAppealProfile({ chatId: input.targetChatId, actingAdminId: input.actingAdminId, settings: source.settings });
        applied.push(section);
        break;
      }
      case "reports": {
        const source = await getChatReportProfile(input.sourceChatId);
        if (!source) break;
        await updateChatReportSettings({ chatId: input.targetChatId, actingAdminId: input.actingAdminId, settings: source.settings });
        applied.push(section);
        break;
      }
      case "roles": {
        const [sourceRoles, targetRoles] = await Promise.all([
          listChatRoles(input.sourceChatId),
          listChatRoles(input.targetChatId)
        ]);
        let matchedAny = false;
        for (const sourceRole of sourceRoles) {
          const match = targetRoles.find((role) => role.key === sourceRole.key)
            ?? (sourceRole.isCustom ? targetRoles.find((role) => role.isCustom && role.label === sourceRole.label) : undefined);
          if (!match) continue;
          await updateChatRolePermissions({
            chatId: input.targetChatId,
            roleId: match.id,
            actingAdminId: input.actingAdminId,
            permissions: sourceRole.permissions
          });
          matchedAny = true;
        }
        if (matchedAny) applied.push(section);
        break;
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      chatId: input.targetChatId,
      actingAdminId: input.actingAdminId,
      source: "ADMIN",
      action: "CHAT_SETTINGS_COPIED",
      metadata: { sourceChatId: input.sourceChatId, sections: applied }
    }
  });

  return { appliedSections: applied };
}
