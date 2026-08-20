import { prisma } from "@/server/db/prisma";

export const GLOBAL_MANUAL_MODERATION_PROFILE_ID = "global";

export type ManualModerationSettingsValue = {
  warnMessageTemplate: string;
  warnDeleteTargetMessage: boolean;
  warnAnnounceInChat: boolean;
  warnEphemeralMessageTemplate: string;
  unwarnMessageTemplate: string;
  unwarnDeleteTargetMessage: boolean;
  unwarnAnnounceInChat: boolean;
  muteMessageTemplate: string;
  muteDeleteTargetMessage: boolean;
  muteAnnounceInChat: boolean;
  muteEphemeralMessageTemplate: string;
  unmuteMessageTemplate: string;
  unmuteDeleteTargetMessage: boolean;
  unmuteAnnounceInChat: boolean;
  banMessageTemplate: string;
  banDeleteTargetMessage: boolean;
  banAnnounceInChat: boolean;
  banEphemeralMessageTemplate: string;
  unbanMessageTemplate: string;
  unbanDeleteTargetMessage: boolean;
  unbanAnnounceInChat: boolean;
};

// The *EphemeralMessageTemplate fields back the punishment ephemeral notice
// (Bot API 10.2 receiver_user_id, see appeal-notification-service.ts) --
// sent for WARNING/MUTE/BAN regardless of how the punishment was applied
// (manual command, automod escalation, or the admin panel), not just from
// the in-chat commands the rest of this settings shape covers. Kept here
// because the per-action data shape already matches exactly.
export const DEFAULT_MANUAL_MODERATION_SETTINGS: ManualModerationSettingsValue = {
  warnMessageTemplate: "⚠️ %target% получил(а) предупреждение (%warns% из %warns_limit%). %reason%",
  warnDeleteTargetMessage: false,
  warnAnnounceInChat: true,
  warnEphemeralMessageTemplate: "⚠️ В чате «%chat%» вам выдано: предупреждение. %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%",
  unwarnMessageTemplate: "✅ С %target% снято предупреждение (осталось %warns% из %warns_limit%).",
  unwarnDeleteTargetMessage: false,
  unwarnAnnounceInChat: true,
  muteMessageTemplate: "🔇 %target% получил(а) mute на %duration%. %reason%",
  muteDeleteTargetMessage: false,
  muteAnnounceInChat: true,
  muteEphemeralMessageTemplate: "⚠️ В чате «%chat%» вам выдано: временное ограничение (mute). %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%",
  unmuteMessageTemplate: "🔊 С %target% снят mute.",
  unmuteDeleteTargetMessage: false,
  unmuteAnnounceInChat: true,
  banMessageTemplate: "⛔ %target% заблокирован(а). %reason%",
  banDeleteTargetMessage: false,
  banAnnounceInChat: true,
  banEphemeralMessageTemplate: "⚠️ В чате «%chat%» вам выдано: блокировка (ban). %reason%\n\nЧтобы оспорить или узнать детали, напишите %contact%",
  unbanMessageTemplate: "✅ С %target% снята блокировка.",
  unbanDeleteTargetMessage: false,
  unbanAnnounceInChat: true
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTemplate(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1000) : fallback;
}

export function normalizeManualModerationSettings(input: ManualModerationSettingsValue): ManualModerationSettingsValue {
  return {
    warnMessageTemplate: normalizeTemplate(input.warnMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.warnMessageTemplate),
    warnDeleteTargetMessage: Boolean(input.warnDeleteTargetMessage),
    warnAnnounceInChat: Boolean(input.warnAnnounceInChat),
    warnEphemeralMessageTemplate: normalizeTemplate(input.warnEphemeralMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.warnEphemeralMessageTemplate),
    unwarnMessageTemplate: normalizeTemplate(input.unwarnMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.unwarnMessageTemplate),
    unwarnDeleteTargetMessage: Boolean(input.unwarnDeleteTargetMessage),
    unwarnAnnounceInChat: Boolean(input.unwarnAnnounceInChat),
    muteMessageTemplate: normalizeTemplate(input.muteMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.muteMessageTemplate),
    muteDeleteTargetMessage: Boolean(input.muteDeleteTargetMessage),
    muteAnnounceInChat: Boolean(input.muteAnnounceInChat),
    muteEphemeralMessageTemplate: normalizeTemplate(input.muteEphemeralMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.muteEphemeralMessageTemplate),
    unmuteMessageTemplate: normalizeTemplate(input.unmuteMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.unmuteMessageTemplate),
    unmuteDeleteTargetMessage: Boolean(input.unmuteDeleteTargetMessage),
    unmuteAnnounceInChat: Boolean(input.unmuteAnnounceInChat),
    banMessageTemplate: normalizeTemplate(input.banMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.banMessageTemplate),
    banDeleteTargetMessage: Boolean(input.banDeleteTargetMessage),
    banAnnounceInChat: Boolean(input.banAnnounceInChat),
    banEphemeralMessageTemplate: normalizeTemplate(input.banEphemeralMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.banEphemeralMessageTemplate),
    unbanMessageTemplate: normalizeTemplate(input.unbanMessageTemplate, DEFAULT_MANUAL_MODERATION_SETTINGS.unbanMessageTemplate),
    unbanDeleteTargetMessage: Boolean(input.unbanDeleteTargetMessage),
    unbanAnnounceInChat: Boolean(input.unbanAnnounceInChat)
  };
}

export function serializeManualModerationSettings(settings: ManualModerationSettingsValue): ManualModerationSettingsValue {
  return {
    warnMessageTemplate: settings.warnMessageTemplate,
    warnDeleteTargetMessage: settings.warnDeleteTargetMessage,
    warnAnnounceInChat: settings.warnAnnounceInChat,
    warnEphemeralMessageTemplate: settings.warnEphemeralMessageTemplate,
    unwarnMessageTemplate: settings.unwarnMessageTemplate,
    unwarnDeleteTargetMessage: settings.unwarnDeleteTargetMessage,
    unwarnAnnounceInChat: settings.unwarnAnnounceInChat,
    muteMessageTemplate: settings.muteMessageTemplate,
    muteDeleteTargetMessage: settings.muteDeleteTargetMessage,
    muteAnnounceInChat: settings.muteAnnounceInChat,
    muteEphemeralMessageTemplate: settings.muteEphemeralMessageTemplate,
    unmuteMessageTemplate: settings.unmuteMessageTemplate,
    unmuteDeleteTargetMessage: settings.unmuteDeleteTargetMessage,
    unmuteAnnounceInChat: settings.unmuteAnnounceInChat,
    banMessageTemplate: settings.banMessageTemplate,
    banDeleteTargetMessage: settings.banDeleteTargetMessage,
    banAnnounceInChat: settings.banAnnounceInChat,
    banEphemeralMessageTemplate: settings.banEphemeralMessageTemplate,
    unbanMessageTemplate: settings.unbanMessageTemplate,
    unbanDeleteTargetMessage: settings.unbanDeleteTargetMessage,
    unbanAnnounceInChat: settings.unbanAnnounceInChat
  };
}

export async function getGlobalManualModerationProfile() {
  const stored = await prisma.globalManualModerationSettings.findUnique({
    where: { id: GLOBAL_MANUAL_MODERATION_PROFILE_ID }
  });
  return {
    persisted: Boolean(stored),
    settings: serializeManualModerationSettings(stored ?? DEFAULT_MANUAL_MODERATION_SETTINGS)
  };
}

export async function updateGlobalManualModerationProfile(input: {
  actingAdminId: string;
  settings: ManualModerationSettingsValue;
}) {
  const normalized = normalizeManualModerationSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.globalManualModerationSettings.upsert({
      where: { id: GLOBAL_MANUAL_MODERATION_PROFILE_ID },
      create: { id: GLOBAL_MANUAL_MODERATION_PROFILE_ID, ...normalized },
      update: normalized
    });
    await tx.auditLog.create({
      data: {
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "GLOBAL_MANUAL_MODERATION_SETTINGS_UPDATED",
        metadata: serializeManualModerationSettings(settings)
      }
    });
    return settings;
  });
  return serializeManualModerationSettings(saved);
}

export async function getChatManualModerationProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { manualModerationSettings: true }
  });
  if (!chat) return null;

  const globalProfile = await getGlobalManualModerationProfile();
  const local = chat.manualModerationSettings;
  // A chat that never made a choice follows the global profile — otherwise
  // globally configured templates would silently apply to no chat at all.
  const useGlobalProfile = local?.useGlobalProfile ?? true;
  const effective = useGlobalProfile
    ? globalProfile.settings
    : serializeManualModerationSettings(local ?? DEFAULT_MANUAL_MODERATION_SETTINGS);

  return {
    chat: {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type
    },
    policy: {
      useGlobalProfile,
      effectiveSource: useGlobalProfile ? ("GLOBAL" as const) : ("CHAT" as const),
      globalProfilePersisted: globalProfile.persisted
    },
    settings: serializeManualModerationSettings(local ?? DEFAULT_MANUAL_MODERATION_SETTINGS),
    effectiveSettings: serializeManualModerationSettings(effective),
    globalSettings: serializeManualModerationSettings(globalProfile.settings)
  };
}

export async function updateChatManualModerationProfile(input: {
  chatId: string;
  actingAdminId: string;
  useGlobalProfile: boolean;
  settings: ManualModerationSettingsValue;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;
  const normalized = normalizeManualModerationSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatManualModerationSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, useGlobalProfile: input.useGlobalProfile, ...normalized },
      update: { useGlobalProfile: input.useGlobalProfile, ...normalized }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "MANUAL_MODERATION_SETTINGS_UPDATED",
        metadata: {
          useGlobalProfile: settings.useGlobalProfile,
          ...serializeManualModerationSettings(settings)
        }
      }
    });
    return settings;
  });
  return {
    useGlobalProfile: saved.useGlobalProfile,
    ...serializeManualModerationSettings(saved)
  };
}

export async function resolveEffectiveManualModerationSettings(chatId: string) {
  const local = await prisma.chatManualModerationSettings.findUnique({ where: { chatId } });
  if (local && !local.useGlobalProfile) {
    return {
      source: "CHAT" as const,
      useGlobalProfile: false,
      settings: serializeManualModerationSettings(local)
    };
  }
  const global = await prisma.globalManualModerationSettings.findUnique({
    where: { id: GLOBAL_MANUAL_MODERATION_PROFILE_ID }
  });
  return {
    source: "GLOBAL" as const,
    useGlobalProfile: true,
    settings: serializeManualModerationSettings(global ?? DEFAULT_MANUAL_MODERATION_SETTINGS)
  };
}

export function renderManualModerationTemplate(
  template: string,
  placeholders: {
    admin?: string;
    target?: string;
    reason?: string;
    duration?: string;
    warns?: string;
    warnsLimit?: string;
    chat?: string;
    contact?: string;
  }
) {
  return template
    .replaceAll("%admin%", placeholders.admin ?? "")
    .replaceAll("%target%", placeholders.target ?? "")
    .replaceAll("%reason%", placeholders.reason ?? "")
    .replaceAll("%duration%", placeholders.duration ?? "")
    .replaceAll("%warns_limit%", placeholders.warnsLimit ?? "")
    .replaceAll("%warns%", placeholders.warns ?? "")
    .replaceAll("%chat%", placeholders.chat ?? "")
    .replaceAll("%contact%", placeholders.contact ?? "");
}
