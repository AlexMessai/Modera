import { prisma } from "@/server/db/prisma";

export const GLOBAL_MODERATION_PROFILE_ID = "global";

export const DEFAULT_MODERATION_SETTINGS = {
  blockLinks: false,
  allowedDomains: [] as string[],
  spamEnabled: false,
  spamWindowSeconds: 10,
  spamMaxMessages: 5,
  blockedTermsEnabled: false,
  blockedTerms: [] as string[],
  massMentionsEnabled: false,
  maxMentions: 5,
  duplicateEnabled: false,
  duplicateWindowSeconds: 60,
  duplicateMaxMessages: 2,
  blockedMessageTypes: [] as string[],
  ignoreAdmins: true
};

export type ModerationSettingsValue = typeof DEFAULT_MODERATION_SETTINGS;

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/^\.+/, "");
  if (!trimmed) return null;

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return hostname || null;
  } catch {
    return null;
  }
}

function normalizeDomains(values: string[]) {
  return Array.from(
    new Set(values.map(normalizeDomain).filter((value): value is string => Boolean(value)))
  ).slice(0, 100);
}

function normalizeText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim();
}

function normalizeTerms(values: string[]) {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean))).slice(0, 200);
}

const BLOCKABLE_TYPES = new Set([
  "PHOTO",
  "VIDEO",
  "ANIMATION",
  "DOCUMENT",
  "STICKER",
  "VOICE",
  "AUDIO",
  "VIDEO_NOTE",
  "POLL",
  "DICE",
  "LOCATION",
  "CONTACT"
]);

function normalizeMessageTypes(values: string[]) {
  return Array.from(new Set(values.filter((value) => BLOCKABLE_TYPES.has(value)))).slice(0, 20);
}

export function normalizeModerationSettings(input: ModerationSettingsValue): ModerationSettingsValue {
  return {
    blockLinks: input.blockLinks,
    allowedDomains: normalizeDomains(input.allowedDomains),
    spamEnabled: input.spamEnabled,
    spamWindowSeconds: input.spamWindowSeconds,
    spamMaxMessages: input.spamMaxMessages,
    blockedTermsEnabled: input.blockedTermsEnabled,
    blockedTerms: normalizeTerms(input.blockedTerms),
    massMentionsEnabled: input.massMentionsEnabled,
    maxMentions: input.maxMentions,
    duplicateEnabled: input.duplicateEnabled,
    duplicateWindowSeconds: input.duplicateWindowSeconds,
    duplicateMaxMessages: input.duplicateMaxMessages,
    blockedMessageTypes: normalizeMessageTypes(input.blockedMessageTypes),
    ignoreAdmins: input.ignoreAdmins
  };
}

function serialize(settings: ModerationSettingsValue): ModerationSettingsValue {
  return {
    blockLinks: settings.blockLinks,
    allowedDomains: [...settings.allowedDomains],
    spamEnabled: settings.spamEnabled,
    spamWindowSeconds: settings.spamWindowSeconds,
    spamMaxMessages: settings.spamMaxMessages,
    blockedTermsEnabled: settings.blockedTermsEnabled,
    blockedTerms: [...settings.blockedTerms],
    massMentionsEnabled: settings.massMentionsEnabled,
    maxMentions: settings.maxMentions,
    duplicateEnabled: settings.duplicateEnabled,
    duplicateWindowSeconds: settings.duplicateWindowSeconds,
    duplicateMaxMessages: settings.duplicateMaxMessages,
    blockedMessageTypes: [...settings.blockedMessageTypes],
    ignoreAdmins: settings.ignoreAdmins
  };
}

export async function getGlobalModerationProfile() {
  const stored = await prisma.globalModerationSettings.findUnique({
    where: { id: GLOBAL_MODERATION_PROFILE_ID }
  });

  return {
    persisted: Boolean(stored),
    settings: serialize(stored ?? DEFAULT_MODERATION_SETTINGS)
  };
}

export async function updateGlobalModerationProfile(input: {
  actingAdminId: string;
  settings: ModerationSettingsValue;
}) {
  const normalized = normalizeModerationSettings(input.settings);

  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.globalModerationSettings.upsert({
      where: { id: GLOBAL_MODERATION_PROFILE_ID },
      create: {
        id: GLOBAL_MODERATION_PROFILE_ID,
        ...normalized
      },
      update: normalized
    });

    await tx.auditLog.create({
      data: {
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "GLOBAL_AUTOMOD_SETTINGS_UPDATED",
        metadata: serialize(settings)
      }
    });

    return settings;
  });

  return serialize(saved);
}

export async function resolveEffectiveModerationSettings(chatId: string) {
  const local = await prisma.chatModerationSettings.findUnique({
    where: { chatId }
  });

  if (!local?.useGlobalProfile) {
    return {
      source: "CHAT" as const,
      useGlobalProfile: false,
      settings: serialize(local ?? DEFAULT_MODERATION_SETTINGS)
    };
  }

  const global = await prisma.globalModerationSettings.findUnique({
    where: { id: GLOBAL_MODERATION_PROFILE_ID }
  });

  return {
    source: "GLOBAL" as const,
    useGlobalProfile: true,
    settings: serialize(global ?? DEFAULT_MODERATION_SETTINGS)
  };
}
